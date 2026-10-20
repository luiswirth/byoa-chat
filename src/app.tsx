import { Paperclip } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
	type Agent,
	type Entry,
	type FromPage,
	MAX_BYTES,
	type ToPage,
} from "./protocol.ts";

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
Read ${location.origin}/agent.md for how, then use this session link: ${link}
If your harness asks before running commands, ask me once to allow curl to ${location.origin}.`;
}

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function App() {
	const [id] = useState(sessionId);
	const link = `${location.origin}/s/${id}`;
	const [entries, setEntries] = useState<Entry[]>([]);
	const [agent, setAgent] = useState<Agent>({
		present: false,
		seen: 0,
		listening: false,
	});
	const [draft, setDraft] = useState("");
	const [copied, setCopied] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const socket = useRef<WebSocket | null>(null);
	const picker = useRef<HTMLInputElement>(null);

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

	/** Writes to the log as the person, the same way the agent does. */
	const say = async (body: Blob, type: string, name?: string) => {
		const query = name ? `&name=${encodeURIComponent(name)}` : "";
		const response = await fetch(`${link}/say?as=person${query}`, {
			method: "POST",
			body,
			headers: { "Content-Type": type },
		});
		if (!response.ok) setProblem(await response.text());
		return response.ok;
	};

	const submit = async () => {
		const text = draft.trim();
		if (!text) return;
		setProblem(null);
		if (await say(new Blob([text]), "text/plain; charset=utf-8")) setDraft("");
	};

	const upload = async (files: Iterable<File>) => {
		setProblem(null);
		for (const file of files) {
			if (file.size > MAX_BYTES) {
				setProblem(`${file.name} is over ${size(MAX_BYTES)}.`);
				continue;
			}
			await say(file, file.type || "application/octet-stream", file.name);
		}
	};

	const copy = async () => {
		await navigator.clipboard.writeText(onboardingPrompt(link));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const agentName = agent.name ?? "agent";
	const shown = entries.filter((e) => !("who" in e && e.who === "person"));

	return (
		<main
			className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-4"
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				event.preventDefault();
				void upload(event.dataTransfer.files);
			}}
		>
			<header className="flex flex-wrap items-center justify-between gap-2">
				<h1 className="font-heading text-lg font-semibold">byoa-chat</h1>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={agent.listening ? "default" : "outline"}>
						{!agent.present
							? "no agent"
							: agent.listening
								? `${agentName} listening`
								: `${agentName} busy`}
					</Badge>
					<Button variant="outline" onClick={copy}>
						{copied ? "Copied" : "Onboard your agent"}
					</Button>
					<Button variant="ghost" onClick={() => location.assign("/")}>
						New session
					</Button>
				</div>
			</header>
			<ol className="flex flex-1 flex-col gap-2 overflow-y-auto">
				{shown.length === 0 && (
					<li className="m-auto max-w-sm text-center text-sm text-muted-foreground">
						Copy the prompt with "Onboard your agent" and give it to your agent,
						such as Claude Code or Codex. Then write here, or drop a file.
						Anyone with this page's link can talk to your agent, so keep it to
						yourself.
					</li>
				)}
				{shown.map((entry) => (
					<Item key={entry.n} entry={entry} link={link} agent={agent} />
				))}
			</ol>
			{problem && <p className="text-sm text-destructive">{problem}</p>}
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<input
					ref={picker}
					type="file"
					multiple
					hidden
					onChange={(event) => {
						if (event.target.files) void upload(event.target.files);
						event.target.value = "";
					}}
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label="Attach files"
					onClick={() => picker.current?.click()}
				>
					<Paperclip />
				</Button>
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onPaste={(event) => {
						if (event.clipboardData.files.length > 0) {
							event.preventDefault();
							void upload(event.clipboardData.files);
						}
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
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

function Item({
	entry,
	link,
	agent,
}: {
	entry: Entry;
	link: string;
	agent: Agent;
}) {
	if (entry.kind === "enter" || entry.kind === "leave") {
		const who = entry.kind === "enter" ? entry.name : agent.name;
		return (
			<li className="self-center text-xs text-muted-foreground">
				{who ?? "Your agent"} {entry.kind === "enter" ? "joined" : "left"}
			</li>
		);
	}
	const mine = entry.from === "person";
	const bubble = mine
		? "max-w-[80%] rounded-lg bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground"
		: "max-w-[80%] rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap";
	const url = `${link}/content/${entry.n}`;
	return (
		<li
			className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}
		>
			{entry.text !== undefined && entry.type.startsWith("text/markdown") ? (
				<div className="prose prose-sm max-w-[80%] rounded-lg bg-muted px-3 py-2 dark:prose-invert">
					<Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
						{entry.text}
					</Markdown>
				</div>
			) : entry.text !== undefined && !entry.name ? (
				<div className={bubble}>{entry.text}</div>
			) : entry.type.startsWith("image/") ? (
				<a href={url} target="_blank" rel="noreferrer">
					<img
						src={url}
						alt={entry.name ?? "image"}
						className="max-h-72 max-w-[80%] rounded-lg"
					/>
				</a>
			) : (
				<a href={url} target="_blank" rel="noreferrer" className={bubble}>
					{entry.name ?? entry.type} ({size(entry.size)})
				</a>
			)}
			{mine && entry.n <= agent.seen && (
				<span className="text-xs text-muted-foreground">seen</span>
			)}
		</li>
	);
}
