import { DurableObject } from "cloudflare:workers";
import type { Message, Update } from "../src/protocol.ts";

/** How long a session outlasts its last page, so that a reload or a locked
 * phone doesn't end it. */
const ABSENT_MS = 5 * 60_000;

/** What a waiting `listen` ends with: what the person said, or why not. */
type Heard = { text: string } | "over" | "replaced";

/** One conversation between one page and one agent. The page is connected
 * over WebSockets, the agent calls `say` and `listen`. */
export class Session extends DurableObject<Env> {
	/** The agent's `listen` call that is waiting, if any. */
	listener: ((heard: Heard) => void) | null = null;
	/** Ends the session once no page has been open for `ABSENT_MS`. */
	absence: ReturnType<typeof setTimeout> | null = null;

	override async fetch(request: Request): Promise<Response> {
		const action = new URL(request.url).pathname.split("/")[3];
		if (action === "ws" && request.headers.get("Upgrade") === "websocket") {
			const [client, server] = Object.values(new WebSocketPair()) as [
				WebSocket,
				WebSocket,
			];
			this.ctx.acceptWebSocket(server);
			await this.watchAbsence();
			this.send(server, { kind: "log", messages: await this.log() });
			this.send(server, {
				kind: "listening",
				listening: this.listener !== null,
			});
			return new Response(null, { status: 101, webSocket: client });
		}
		if (action === "say" && request.method === "POST") {
			const text = (await request.text()).trim();
			if (!text) return new Response("empty message\n", { status: 400 });
			await this.answered();
			await this.add({ from: "agent", text });
			return new Response(null, { status: 204 });
		}
		if (action === "listen" && request.method === "GET") {
			return this.listen();
		}
		return new Response("not found\n", { status: 404 });
	}

	/** What the person said that the agent hasn't answered yet, or after
	 * waiting for it, however long that takes. */
	async listen(): Promise<Response> {
		const queued = await this.unanswered();
		if (queued) return new Response(`${queued}\n`);
		this.listener?.("replaced");
		this.listener = null;
		await this.watchAbsence();
		let listener: (heard: Heard) => void = () => {};
		const heard = await new Promise<Heard>((resolve) => {
			listener = resolve;
			this.listener = listener;
			this.broadcast({ kind: "listening", listening: true });
		});
		if (this.listener === listener) {
			this.listener = null;
			this.broadcast({ kind: "listening", listening: false });
		}
		if (typeof heard === "object") return new Response(`${heard.text}\n`);
		if (heard === "over")
			return new Response("the page was closed\n", { status: 410 });
		return new Response("a newer listen replaced this one\n", {
			status: 409,
		});
	}

	override async webSocketMessage(
		_ws: WebSocket,
		data: string | ArrayBuffer,
	): Promise<void> {
		if (typeof data !== "string") return;
		const text = data.trim();
		if (!text) return;
		await this.add({ from: "person", text });
		if (this.listener) {
			const queued = await this.unanswered();
			if (queued) this.listener({ text: queued });
		}
	}

	override async webSocketClose(): Promise<void> {
		await this.watchAbsence();
	}

	/** Times the session's end while no page is open, and stops timing once
	 * one is. */
	async watchAbsence(): Promise<void> {
		if (this.absence) clearTimeout(this.absence);
		const open = this.ctx
			.getWebSockets()
			.some((ws) => ws.readyState === WebSocket.OPEN);
		if (open) {
			await this.ctx.storage.delete("absentSince");
			return;
		}
		let since = await this.ctx.storage.get<number>("absentSince");
		if (since === undefined) {
			since = Date.now();
			await this.ctx.storage.put("absentSince", since);
		}
		this.absence = setTimeout(
			() => this.listener?.("over"),
			since + ABSENT_MS - Date.now(),
		);
	}

	/** Records a message, shows it on every page, and queues the person's
	 * for the agent. */
	async add(message: Message): Promise<void> {
		await this.ctx.storage.put("log", [...(await this.log()), message]);
		if (message.from === "person") {
			const queue = (await this.ctx.storage.get<string[]>("queue")) ?? [];
			await this.ctx.storage.put("queue", [...queue, message.text]);
		}
		this.broadcast({ kind: "message", message });
	}

	async log(): Promise<Message[]> {
		return (await this.ctx.storage.get<Message[]>("log")) ?? [];
	}

	/** The person's messages the agent hasn't answered, joined. They stay
	 * until the agent's next `say`, since a `listen` that was cut off would
	 * otherwise lose them. */
	async unanswered(): Promise<string | null> {
		const queue = (await this.ctx.storage.get<string[]>("queue")) ?? [];
		if (queue.length === 0) return null;
		await this.ctx.storage.put("heard", queue.length);
		return queue.join("\n\n");
	}

	/** Drops the messages `listen` returned, now that the agent answers. */
	async answered(): Promise<void> {
		const heard = (await this.ctx.storage.get<number>("heard")) ?? 0;
		const queue = (await this.ctx.storage.get<string[]>("queue")) ?? [];
		await this.ctx.storage.put("queue", queue.slice(heard));
		await this.ctx.storage.delete("heard");
	}

	broadcast(update: Update): void {
		for (const ws of this.ctx.getWebSockets()) this.send(ws, update);
	}

	send(ws: WebSocket, update: Update): void {
		ws.send(JSON.stringify(update));
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		// `/s/<id>/<action>`: the id is the session's whole secret.
		const [, s, id] = new URL(request.url).pathname.split("/");
		if (s === "s" && id) {
			return env.SESSION.getByName(id).fetch(request);
		}
		return new Response("not found\n", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
