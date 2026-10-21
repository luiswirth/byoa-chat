import {
	create,
	type Entry,
	JOIN,
	LEAVE,
	type Presence,
	Session,
} from "byoa/client";
import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";

/** The relay sessions live on. */
const RELAY: string = import.meta.env.VITE_RELAY ?? "http://localhost:8790";

/** The name the page takes part under. */
const PERSON = "person";

/** Payloads larger than this are refused by the relay. */
const MAX_BYTES = 10 * 1024 * 1024;

/** The session this page shows, from `/s/<id>`. */
const sessionId = () => location.pathname.match(/^\/s\/([\w-]+)$/)?.[1];

function onboardingPrompt(link: string): string {
	return `Talk with me through byoa-chat, a page in my browser.
Read ${location.origin}/agent.md for how, then use this session link: ${link}
If your harness asks before running commands, ask me once to allow curl to ${new URL(link).origin}.`;
}

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function App() {
	const [id, setId] = useState(sessionId);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		if (id) return;
		create(RELAY).then(
			(link) => {
				const made = link.split("/").at(-1) ?? "";
				history.replaceState(null, "", `/s/${made}`);
				setId(made);
			},
			(error: Error) => setProblem(`No session: ${error.message}`),
		);
	}, [id]);

	if (!id) return <p className="p-4 text-sm text-destructive">{problem}</p>;
	return <Chat key={id} link={`${RELAY}/${id}`} />;
}

function Chat({ link }: { link: string }) {
	const [session] = useState(() => new Session(link, PERSON));
	const [entries, setEntries] = useState<Entry[]>([]);
	const [presence, setPresence] = useState<Presence>({});
	const [draft, setDraft] = useState("");
	const [copied, setCopied] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const picker = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const unsubscribe = session.subscribe({
			entry: () => setEntries([...session.log]),
			presence: setPresence,
			end: setProblem,
		});
		session.join().catch((error: Error) => setProblem(error.message));
		return () => {
			unsubscribe();
			session.close();
		};
	}, [session]);

	const send = async (
		body: string | Blob,
		options: { type?: string; filename?: string },
	) => {
		try {
			await session.send(body, options);
			return true;
		} catch (error) {
			setProblem((error as Error).message);
			return false;
		}
	};

	const submit = async () => {
		const text = draft.trim();
		if (!text) return;
		setProblem(null);
		if (await send(text, { type: "text/plain; charset=utf-8" })) setDraft("");
	};

	const upload = async (files: Iterable<File>) => {
		setProblem(null);
		for (const file of files) {
			if (file.size > MAX_BYTES) {
				setProblem(`${file.name} is over ${size(MAX_BYTES)}.`);
				continue;
			}
			await send(file, {
				type: file.type || "application/octet-stream",
				filename: file.name,
			});
		}
	};

	const copy = async () => {
		await navigator.clipboard.writeText(onboardingPrompt(link));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const others = Object.entries(presence).filter(([name]) => name !== PERSON);
	const shown = entries.filter(
		(entry) =>
			!(entry.from === PERSON && (entry.type === JOIN || entry.type === LEAVE)),
	);

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
					{others.length === 0 && <Badge variant="outline">no agent</Badge>}
					{others.map(([name, { receiving }]) => (
						<Badge key={name} variant={receiving ? "default" : "outline"}>
							{name} {receiving ? "listening" : "busy"}
						</Badge>
					))}
					<Button variant="outline" onClick={copy}>
						{copied ? "Copied" : "Onboard your agent"}
					</Button>
					<Button
						variant="ghost"
						onClick={async () => {
							await session.leave().catch(() => {});
							location.assign("/");
						}}
					>
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
					<Item
						key={entry.n}
						entry={entry}
						session={session}
						seenBy={others
							.filter(([, { read }]) => read >= entry.n)
							.map(([name]) => name)}
					/>
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
	session,
	seenBy,
}: {
	entry: Entry;
	session: Session;
	seenBy: string[];
}) {
	if (entry.type === JOIN || entry.type === LEAVE) {
		return (
			<li className="self-center text-xs text-muted-foreground">
				{entry.from} {entry.type === JOIN ? "joined" : "left"}
			</li>
		);
	}
	// Other protocols' entries, such as voice's, are for the parts that
	// speak them.
	if (entry.type.startsWith("application/vnd.byoa.")) return null;
	const mine = entry.from === PERSON;
	const bubble = mine
		? "max-w-[80%] rounded-lg bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground"
		: "max-w-[80%] rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap";
	const url = session.url(entry.n);
	return (
		<li
			className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}
		>
			{!mine && (
				<span className="text-xs text-muted-foreground">{entry.from}</span>
			)}
			{entry.text !== undefined && entry.type.startsWith("text/markdown") ? (
				<div className="prose prose-sm max-w-[80%] rounded-lg bg-muted px-3 py-2 dark:prose-invert">
					<Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
						{entry.text}
					</Markdown>
				</div>
			) : entry.text !== undefined && !entry.filename ? (
				<div className={bubble}>{entry.text}</div>
			) : entry.type.startsWith("image/") ? (
				<a href={url} target="_blank" rel="noreferrer">
					<img
						src={url}
						alt={entry.filename ?? "image"}
						className="max-h-72 max-w-[80%] rounded-lg"
					/>
				</a>
			) : (
				<a href={url} target="_blank" rel="noreferrer" className={bubble}>
					{entry.filename ?? entry.type} ({size(entry.size)})
				</a>
			)}
			{mine && seenBy.length > 0 && (
				<span className="text-xs text-muted-foreground">
					seen by {seenBy.join(", ")}
				</span>
			)}
		</li>
	);
}
