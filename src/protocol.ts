/** What the page and the Worker say to each other, shared by both. */

export type Party = "person" | "agent";

/** Files larger than this are refused, since the relay stores them. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** One numbered entry of a session's log: something said, a file, or
 * someone entering or leaving. A file's content is at `<link>/files/<n>`. */
export type Entry = { n: number; time: string } & (
	| { kind: "message"; from: Party; text: string }
	| { kind: "file"; from: Party; name: string; type: string; size: number }
	| { kind: "enter"; who: Party; name?: string }
	| { kind: "leave"; who: Party }
);

/** The agent as the page sees it. */
export type Agent = {
	present: boolean;
	name?: string;
	/** How far it has read the log. */
	seen: number;
	/** Whether it is waiting to hear more. */
	listening: boolean;
};

/** From the page to the Worker. Files go up over HTTP instead. */
export type FromPage =
	| { kind: "say"; text: string }
	| { kind: "seen"; n: number };

/** From the Worker to the page. */
export type ToPage =
	| { kind: "log"; entries: Entry[]; agent: Agent }
	| { kind: "entry"; entry: Entry }
	| { kind: "agent"; agent: Agent };
