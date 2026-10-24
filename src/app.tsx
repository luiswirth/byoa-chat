// A page to chat with an agent, on a session of the byoa transport.
// Whoever starts creates the session: the page, which then hands the agent
// a prompt with its link, or the agent, which gives the person the page with
// the link as `#session=<link>`.
import { type Entry, JOIN, LEAVE, type Session } from "byoa/participant";
import { Named, Onboard } from "byoa-web/onboard";
import { useSession } from "byoa-web/react";
import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";

/** Payloads larger than this are refused by the relay. */
const MAX_BYTES = 10 * 1024 * 1024;

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function App() {
	return (
		<Named service="chat.senses.sh">{(name) => <Chat name={name} />}</Named>
	);
}

/** The chat, taking part under the person's `name`. */
function Chat({ name }: { name: string }) {
	const page = useSession(name);
	const [draft, setDraft] = useState("");
	const [failure, setFailure] = useState<string | null>(null);
	const picker = useRef<HTMLInputElement>(null);
	const { session, entries, presence, alone, leave } = page;
	const problem = page.problem ?? failure;

	if (session && alone) {
		return (
			<Onboard
				name="chat.senses.sh"
				title="Chat with your agent"
				description="Write to the agent you already use, and read its answers, here in your browser."
				link={session.link}
			/>
		);
	}

	const send = async (
		body: string | Blob,
		options: { type?: string; filename?: string },
	) => {
		if (!session) return false;
		try {
			await session.send(body, options);
			return true;
		} catch (error) {
			setFailure((error as Error).message);
			return false;
		}
	};

	const submit = async () => {
		const text = draft.trim();
		if (!text) return;
		setFailure(null);
		if (await send(text, { type: "text/plain; charset=utf-8" })) setDraft("");
	};

	const upload = async (files: Iterable<File>) => {
		setFailure(null);
		for (const file of files) {
			if (file.size > MAX_BYTES) {
				setFailure(`${file.name} is over ${size(MAX_BYTES)}.`);
				continue;
			}
			await send(file, {
				type: file.type || "application/octet-stream",
				filename: file.name,
			});
		}
	};

	const others = Object.entries(presence).filter(([other]) => other !== name);
	const shown = entries.filter(
		(entry) =>
			!(entry.from === name && (entry.type === JOIN || entry.type === LEAVE)),
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
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<span className="flex-1">Keep this page's link secret.</span>
				{others.map(([name, { receiving }]) => (
					<Badge key={name} variant={receiving ? "default" : "outline"}>
						{name} {receiving ? "listening" : "busy"}
					</Badge>
				))}
				<Button
					variant="outline"
					size="sm"
					disabled={session === null}
					title="Leave the session: once everyone has left, it is deleted"
					onClick={leave}
				>
					Leave
				</Button>
			</div>
			<ol className="flex flex-1 flex-col gap-2 overflow-y-auto">
				{session &&
					shown.map((entry) => (
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
				<Button type="submit" disabled={session === null}>
					Send
				</Button>
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
	const mine = entry.from === session.name;
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
