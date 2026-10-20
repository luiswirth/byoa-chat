import { DurableObject } from "cloudflare:workers";
import {
	type Agent,
	type Entry,
	type FromPage,
	MAX_FILE_BYTES,
	type Party,
	type ToPage,
} from "../src/protocol.ts";

/** How long a session outlasts the person's last page, so that a reload or a
 * locked phone doesn't end it. */
const ABSENT_MS = 5 * 60_000;

type New<T> = T extends unknown ? Omit<T, "n" | "time"> : never;

const text = (body: string, status = 200) =>
	new Response(`${body}\n`, { status });

/** One conversation between a person's page and their agent, as one
 * numbered log. The page is connected over WebSockets, the agent calls
 * `enter`, `say`, `listen` and `leave`. Nobody takes turns: either side
 * writes whenever it wants, and reads from where it is. */
export class Session extends DurableObject<Env> {
	/** Wakes the agent's `listen`, if one is waiting, to look again or to
	 * give way to a newer one. */
	listener: ((replaced: boolean) => void) | null = null;
	/** The `listen` that is current, while there is one. */
	listening: symbol | null = null;
	absence: ReturnType<typeof setTimeout> | null = null;

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const [, , , action, arg] = url.pathname.split("/");
		const method = request.method;
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
		if (action === "files" && arg && method === "GET") return this.file(arg);
		if (action === "upload" && method === "POST") {
			return this.say(request, "person", url.searchParams.get("file"));
		}
		// The rest is the agent's.
		if (action === "enter" && method === "POST") {
			await this.enter((await request.text()).trim() || undefined);
			return text("entered");
		}
		if (action === "leave" && method === "POST") {
			if (await this.storage<boolean>("agentPresent")) {
				await this.ctx.storage.put("agentPresent", false);
				await this.append({ kind: "leave", who: "agent" });
			}
			return text("left");
		}
		if (action === "say" && method === "POST") {
			await this.enter();
			return this.say(request, "agent", url.searchParams.get("file"));
		}
		if (action === "listen" && method === "GET") {
			await this.enter();
			const after = url.searchParams.get("after");
			return this.listen(after === null ? null : Number(after));
		}
		return text("not found", 404);
	}

	/** Logs the agent entering, unless it is in already. */
	async enter(name?: string): Promise<void> {
		if (await this.storage<boolean>("agentPresent")) return;
		await this.ctx.storage.put("agentPresent", true);
		if (name) await this.ctx.storage.put("agentName", name);
		await this.append({ kind: "enter", who: "agent", ...(name && { name }) });
	}

	/** A message, or a file when the request names one. */
	async say(
		request: Request,
		from: Party,
		file: string | null,
	): Promise<Response> {
		if (file === null) {
			const body = (await request.text()).trim();
			if (!body) return text("empty message", 400);
			const entry = await this.append({ kind: "message", from, text: body });
			return Response.json({ n: entry.n });
		}
		const bytes = await request.arrayBuffer();
		if (bytes.byteLength > MAX_FILE_BYTES) {
			return text(`files are limited to ${MAX_FILE_BYTES} bytes`, 413);
		}
		// curl sends a form's type unless told otherwise, which says nothing.
		const sent = request.headers.get("Content-Type") ?? "";
		const type =
			!sent || sent.startsWith("application/x-www-form-urlencoded")
				? "application/octet-stream"
				: sent;
		// Stored before its entry is numbered, so under a key of its own.
		const key = `${this.ctx.id.toString()}/${crypto.randomUUID()}`;
		await this.env.FILES.put(key, bytes, {
			httpMetadata: { contentType: type },
		});
		const entry = await this.append({
			kind: "file",
			from,
			name: file || "file",
			type,
			size: bytes.byteLength,
		});
		await this.ctx.storage.put(`file:${entry.n}`, key);
		return Response.json({ n: entry.n });
	}

	async file(n: string): Promise<Response> {
		const entry = (await this.log())[Number(n) - 1];
		const key = await this.storage<string>(`file:${n}`);
		const object = key ? await this.env.FILES.get(key) : null;
		if (entry?.kind !== "file" || !object) return text("no such file", 404);
		return new Response(object.body, {
			headers: {
				"Content-Type": entry.type,
				"Content-Disposition": `inline; filename="${encodeURIComponent(entry.name)}"`,
			},
		});
	}

	/** The entries after `after`, or after what the agent last acknowledged,
	 * leaving out its own; waits for some, however long that takes. Asking
	 * for what comes after `after` acknowledges everything up to it. */
	async listen(after: number | null): Promise<Response> {
		if (after !== null && !Number.isInteger(after)) {
			return text("after must be a number", 400);
		}
		const seen = (await this.storage<number>("agentSeen")) ?? 0;
		if (after !== null && after > seen) {
			await this.ctx.storage.put("agentSeen", after);
		}
		const from = after ?? seen;
		this.listener?.(true);
		this.listener = null;
		const call = Symbol();
		this.listening = call;
		await this.broadcastAgent();
		try {
			for (;;) {
				const entries = (await this.log()).filter(
					(e) => e.n > from && ("from" in e ? e.from : e.who) !== "agent",
				);
				if (entries.length > 0) {
					const lines = entries.map((e) => JSON.stringify(e));
					const personSeen = (await this.storage<number>("personSeen")) ?? 0;
					lines.push(JSON.stringify({ kind: "status", personSeen }));
					return new Response(`${lines.join("\n")}\n`, {
						headers: { "Content-Type": "application/jsonl" },
					});
				}
				if (await this.over()) return text("the person left", 410);
				let wake: (replaced: boolean) => void = () => {};
				const replaced = await new Promise<boolean>((resolve) => {
					wake = resolve;
					this.listener = wake;
				});
				if (this.listener === wake) this.listener = null;
				if (replaced) return text("a newer listen replaced this one", 409);
			}
		} finally {
			if (this.listening === call) {
				this.listening = null;
				await this.broadcastAgent();
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
			const seen = (await this.storage<number>("personSeen")) ?? 0;
			const n = Math.min(message.n, (await this.log()).length);
			if (n > seen) await this.ctx.storage.put("personSeen", n);
		}
	}

	override async webSocketClose(): Promise<void> {
		await this.pagesChanged();
	}

	/** Logs the person entering with their first page and leaving with
	 * their last, and times the session's end while no page is open. */
	async pagesChanged(): Promise<void> {
		const open = this.ctx
			.getWebSockets()
			.some((ws) => ws.readyState === WebSocket.OPEN);
		if (open !== ((await this.storage<boolean>("personPresent")) ?? false)) {
			await this.ctx.storage.put("personPresent", open);
			await this.append(
				open
					? { kind: "enter", who: "person" }
					: { kind: "leave", who: "person" },
			);
		}
		if (this.absence) clearTimeout(this.absence);
		if (open) {
			await this.ctx.storage.delete("absentSince");
			return;
		}
		let since = await this.storage<number>("absentSince");
		if (since === undefined) {
			since = Date.now();
			await this.ctx.storage.put("absentSince", since);
		}
		this.absence = setTimeout(
			() => this.listener?.(false),
			since + ABSENT_MS - Date.now(),
		);
	}

	/** Whether the person has had no page open for `ABSENT_MS`. */
	async over(): Promise<boolean> {
		const since = await this.storage<number>("absentSince");
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
		await this.broadcastAgent();
		this.listener?.(false);
		return full;
	}

	async log(): Promise<Entry[]> {
		return (await this.storage<Entry[]>("log")) ?? [];
	}

	async agent(): Promise<Agent> {
		const name = await this.storage<string>("agentName");
		return {
			present: (await this.storage<boolean>("agentPresent")) ?? false,
			...(name && { name }),
			seen: (await this.storage<number>("agentSeen")) ?? 0,
			listening: this.listening !== null,
		};
	}

	storage<T>(key: string): Promise<T | undefined> {
		return this.ctx.storage.get<T>(key);
	}

	async broadcastAgent(): Promise<void> {
		this.broadcast({ kind: "agent", agent: await this.agent() });
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
		return text("not found", 404);
	},
} satisfies ExportedHandler<Env>;
