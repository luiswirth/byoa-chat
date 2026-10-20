import { DurableObject } from "cloudflare:workers";
import type { Message, Update } from "../src/protocol.ts";

/** How long `listen` waits before it returns empty, well below the 100 s
 * after which Cloudflare cuts off a response that sends nothing. */
const LISTEN_MS = 60_000;

/** One conversation between one page and one agent. The page is connected
 * over WebSockets, the agent calls `say` and `listen`. */
export class Session extends DurableObject<Env> {
	/** The agent's `listen` call that is waiting, if any. */
	listener: ((text: string | null) => void) | null = null;

	override async fetch(request: Request): Promise<Response> {
		const action = new URL(request.url).pathname.split("/")[3];
		if (action === "ws" && request.headers.get("Upgrade") === "websocket") {
			const [client, server] = Object.values(new WebSocketPair()) as [
				WebSocket,
				WebSocket,
			];
			this.ctx.acceptWebSocket(server);
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
			await this.add({ from: "agent", text });
			return new Response(null, { status: 204 });
		}
		if (action === "listen" && request.method === "GET") {
			return this.listen();
		}
		return new Response("not found\n", { status: 404 });
	}

	/** What the person said since the last `listen`, or after waiting for it. */
	async listen(): Promise<Response> {
		const queued = await this.takeQueue();
		if (queued) return new Response(`${queued}\n`);
		// A newer call replaces a waiting one.
		this.listener?.(null);
		let listener: (text: string | null) => void = () => {};
		const text = await new Promise<string | null>((resolve) => {
			const timer = setTimeout(() => resolve(null), LISTEN_MS);
			listener = (text) => {
				clearTimeout(timer);
				resolve(text);
			};
			this.listener = listener;
			this.broadcast({ kind: "listening", listening: true });
		});
		if (this.listener === listener) {
			this.listener = null;
			this.broadcast({ kind: "listening", listening: false });
		}
		return text === null
			? new Response(null, { status: 204 })
			: new Response(`${text}\n`);
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
			const queued = await this.takeQueue();
			if (queued) this.listener(queued);
		}
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

	/** Empties the queue, joining what was in it. */
	async takeQueue(): Promise<string | null> {
		const queue = (await this.ctx.storage.get<string[]>("queue")) ?? [];
		if (queue.length === 0) return null;
		await this.ctx.storage.delete("queue");
		return queue.join("\n\n");
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
