import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import type { Message, Update } from "./protocol.ts";

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
	const [messages, setMessages] = useState<Message[]>([]);
	const [listening, setListening] = useState(false);
	const [draft, setDraft] = useState("");
	const [copied, setCopied] = useState(false);
	const socket = useRef<WebSocket | null>(null);

	useEffect(() => {
		let closed = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			const ws = new WebSocket(`${link.replace(/^http/, "ws")}/ws`);
			ws.onmessage = (event) => {
				const update = JSON.parse(event.data) as Update;
				if (update.kind === "log") setMessages(update.messages);
				if (update.kind === "message")
					setMessages((all) => [...all, update.message]);
				if (update.kind === "listening") setListening(update.listening);
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

	const send = () => {
		const text = draft.trim();
		if (!text || socket.current?.readyState !== WebSocket.OPEN) return;
		socket.current.send(text);
		setDraft("");
	};

	const copy = async () => {
		await navigator.clipboard.writeText(onboardingPrompt(link));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<main className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-4">
			<header className="flex items-center justify-between gap-2">
				<h1 className="font-heading text-lg font-semibold">byoa-chat</h1>
				<div className="flex items-center gap-2">
					<Badge variant={listening ? "default" : "outline"}>
						{listening ? "agent listening" : "agent away"}
					</Badge>
					<Button variant="outline" onClick={copy}>
						{copied ? "Copied" : "Onboard your agent"}
					</Button>
				</div>
			</header>
			<ol className="flex flex-1 flex-col gap-2 overflow-y-auto">
				{messages.map((message, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: the log only grows
						key={index}
						className={
							message.from === "person"
								? "max-w-[80%] self-end rounded-lg bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground"
								: "max-w-[80%] self-start rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap"
						}
					>
						{message.text}
					</li>
				))}
			</ol>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					send();
				}}
			>
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							send();
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
