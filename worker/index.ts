import { DurableObject } from "cloudflare:workers";
import type { Entry, FromPage, ToPage } from "../src/protocol.ts";

/** How long a session outlasts its last page, so that a reload or a locked
 * phone doesn't end it. */
const ABSENT_MS = 5 * 60_000;

type New<T> = T extends unknown ? Omit<T, "n" | "time"> : never;

/** One conversation between one page and one agent, as one numbered log.
 * The page is connected over WebSockets, the agent calls `say` and
 * `listen`. Nobody takes turns: either side writes whenever it wants, and
 * reads from where it is. */
export class Session extends DurableObject<Env> {
	/** Wakes the agent's `listen`, if one is waiting, to look again or to
	 * give way to a newer one. */
	listener: ((replaced: boolean) => void) | null = null;
	/** The `listen` that is current, while there is one. */
	listening: symbol | null = null;
	absence: ReturnType<typeof setTimeout> | null = null;

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const action = url.pathname.split("/")[3];
		if (action === "ws" && request.headers.get("Upgrade") === "websocket") {
			const [client, server] = Object.values(new WebSocketPair()) as [
				WebSocket,
				WebSocket,
			];
			this.ctx.acceptWebSocket(server);
			await this.pagesChanged();
			this.send(server, {
				kind: "log",
				entries: await this.log(),
				agent: await this.agent(),
			});
			return new Response(null, { status: 101, webSocket: client });
		}
		if (action === "say" && request.method === "POST") {
			const text = (await request.text()).trim();
			if (!text) return new Response("empty message\n", { status: 400 });
			const entry = await this.append({ kind: "message", from: "agent", text });
			return Response.json({ n: entry.n });
		}
		if (action === "listen" && request.method === "GET") {
			const after = url.searchParams.get("after");
			return this.listen(after === null ? null : Number(after));
		}
		return new Response("not found\n", { status: 404 });
	}

	/** The entries after `after`, or after what the agent last acknowledged,
	 * leaving out its own messages; waits for some, however long that takes.
	 * Asking for what comes after `after` acknowledges everything up to it. */
	async listen(after: number | null): Promise<Response> {
		if (after !== null && !Number.isInteger(after)) {
			return new Response("after must be a number\n", { status: 400 });
		}
		const agent = await this.agent();
		if (after !== null && after > agent.seen) {
			agent.seen = after;
			await this.ctx.storage.put("agentSeen", after);
		}
		const from = after ?? agent.seen;
		this.listener?.(true);
		this.listener = null;
		const call = Symbol();
		this.listening = call;
		this.broadcastAgent();
		try {
			for (;;) {
				const entries = (await this.log()).filter(
					(e) => e.n > from && !(e.kind === "message" && e.from === "agent"),
				);
				if (entries.length > 0) {
					const lines = entries.map((e) => JSON.stringify(e));
					const personSeen =
						(await this.ctx.storage.get<number>("personSeen")) ?? 0;
					lines.push(JSON.stringify({ kind: "status", personSeen }));
					return new Response(`${lines.join("\n")}\n`, {
						headers: { "Content-Type": "application/jsonl" },
					});
				}
				if (await this.over()) {
					return new Response("the page was closed\n", { status: 410 });
				}
				let wake: (replaced: boolean) => void = () => {};
				const replaced = await new Promise<boolean>((resolve) => {
					wake = resolve;
					this.listener = wake;
				});
				if (this.listener === wake) this.listener = null;
				if (replaced) {
					return new Response("a newer listen replaced this one\n", {
						status: 409,
					});
				}
			}
		} finally {
			if (this.listening === call) {
				this.listening = null;
				this.broadcastAgent();
			}
		}
	}

	override async webSocketMessage(
		_ws: WebSocket,
		data: string | ArrayBuffer,
	): Promise<void> {
		if (typeof data !== "string") return;
		const message = JSON.parse(data) as FromPage;
		if (message.kind === "say" && message.text.trim()) {
			await this.append({
				kind: "message",
				from: "person",
				text: message.text.trim(),
			});
		}
		if (message.kind === "seen") {
			const seen = (await this.ctx.storage.get<number>("personSeen")) ?? 0;
			const n = Math.min(message.n, (await this.log()).length);
			if (n > seen) await this.ctx.storage.put("personSeen", n);
		}
	}

	override async webSocketClose(): Promise<void> {
		await this.pagesChanged();
	}

	/** Logs a page opening or the last one closing, and times the session's
	 * end while none is open. */
	async pagesChanged(): Promise<void> {
		const open = this.ctx
			.getWebSockets()
			.some((ws) => ws.readyState === WebSocket.OPEN);
		const wasOpen = (await this.ctx.storage.get<boolean>("pageOpen")) ?? false;
		if (open !== wasOpen) {
			await this.ctx.storage.put("pageOpen", open);
			await this.append({ kind: "page", open });
		}
		if (this.absence) clearTimeout(this.absence);
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
			() => this.listener?.(false),
			since + ABSENT_MS - Date.now(),
		);
	}

	/** Whether no page has been open for `ABSENT_MS`. */
	async over(): Promise<boolean> {
		const since = await this.ctx.storage.get<number>("absentSince");
		return since !== undefined && Date.now() - since >= ABSENT_MS;
	}

	async append(entry: New<Entry>): Promise<Entry> {
		const log = await this.log();
		const full = {
			n: log.length + 1,
			time: new Date().toISOString(),
			...entry,
		} as Entry;
		await this.ctx.storage.put("log", [...log, full]);
		this.broadcast({ kind: "entry", entry: full });
		this.listener?.(false);
		return full;
	}

	async log(): Promise<Entry[]> {
		return (await this.ctx.storage.get<Entry[]>("log")) ?? [];
	}

	async agent(): Promise<{ seen: number; listening: boolean }> {
		const seen = (await this.ctx.storage.get<number>("agentSeen")) ?? 0;
		return { seen, listening: this.listening !== null };
	}

	broadcastAgent(): void {
		void this.agent().then((agent) => this.broadcast({ kind: "agent", agent }));
	}

	broadcast(update: ToPage): void {
		for (const ws of this.ctx.getWebSockets()) this.send(ws, update);
	}

	send(ws: WebSocket, update: ToPage): void {
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
