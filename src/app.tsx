import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import type { Agent, Entry, FromPage, ToPage } from "./protocol.ts";

/** The session this page shows, from `/s/<id>`, made up on the first visit. */
function sessionId(): string {
	const id = location.pathname.match(/^\/s\/([\w-]+)$/)?.[1];
	if (id) return id;
	const made = crypto.randomUUID();
	history.replaceState(null, "", `/s/${made}`);
	return made;
}

function onboardingPrompt(link: string): string {
	return `Talk with me through byoa-chat, a page in my browser.
Read ${location.origin}/agent.md for how, then use this session link: ${link}`;
}

export function App() {
	const [id] = useState(sessionId);
	const link = `${location.origin}/s/${id}`;
	const [entries, setEntries] = useState<Entry[]>([]);
	const [agent, setAgent] = useState<Agent>({ seen: 0, listening: false });
	const [draft, setDraft] = useState("");
	const [copied, setCopied] = useState(false);
	const socket = useRef<WebSocket | null>(null);

	useEffect(() => {
		let closed = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			const ws = new WebSocket(`${link.replace(/^http/, "ws")}/ws`);
			ws.onmessage = (event) => {
				const update = JSON.parse(event.data) as ToPage;
				if (update.kind === "log") {
					setEntries(update.entries);
					setAgent(update.agent);
				}
				if (update.kind === "entry")
					setEntries((all) => [...all, update.entry]);
				if (update.kind === "agent") setAgent(update.agent);
			};
			ws.onclose = () => {
				if (!closed) retry = setTimeout(connect, 1000);
			};
			socket.current = ws;
		};
		connect();
		return () => {
			closed = true;
			clearTimeout(retry);
			socket.current?.close();
		};
	}, [link]);

	const send = useCallback((message: FromPage) => {
		if (socket.current?.readyState === WebSocket.OPEN)
			socket.current.send(JSON.stringify(message));
	}, []);

	// What the person has seen: everything shown while the page is visible.
	const last = entries.at(-1)?.n ?? 0;
	useEffect(() => {
		const report = () => {
			if (document.visibilityState === "visible")
				send({ kind: "seen", n: last });
		};
		report();
		document.addEventListener("visibilitychange", report);
		return () => document.removeEventListener("visibilitychange", report);
	}, [last, send]);

	const submit = () => {
		const text = draft.trim();
		if (!text || socket.current?.readyState !== WebSocket.OPEN) return;
		send({ kind: "say", text });
		setDraft("");
	};

	const copy = async () => {
		await navigator.clipboard.writeText(onboardingPrompt(link));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const messages = entries.filter((e) => e.kind === "message");

	return (
		<main className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-4">
			<header className="flex items-center justify-between gap-2">
				<h1 className="font-heading text-lg font-semibold">byoa-chat</h1>
				<div className="flex items-center gap-2">
					<Badge variant={agent.listening ? "default" : "outline"}>
						{agent.listening ? "agent listening" : "agent busy or away"}
					</Badge>
					<Button variant="outline" onClick={copy}>
						{copied ? "Copied" : "Onboard your agent"}
					</Button>
				</div>
			</header>
			<ol className="flex flex-1 flex-col gap-2 overflow-y-auto">
				{messages.map((message) =>
					message.from === "person" ? (
						<li key={message.n} className="flex flex-col items-end gap-0.5">
							<div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground">
								{message.text}
							</div>
							{message.n <= agent.seen && (
								<span className="text-xs text-muted-foreground">seen</span>
							)}
						</li>
					) : (
						<li
							key={message.n}
							className="max-w-[80%] self-start rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap"
						>
							{message.text}
						</li>
					),
				)}
			</ol>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
					placeholder="Say something to your agent"
					rows={2}
				/>
				<Button type="submit">Send</Button>
			</form>
		</main>
	);
}
