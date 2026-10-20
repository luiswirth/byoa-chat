/** What the page and the Worker say to each other, shared by both. */

export type Party = "person" | "agent";

/** Payloads larger than this are refused, since the relay stores them. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Text payloads up to this size come inline, as `text`. */
export const INLINE_BYTES = 64 * 1024;

/** One numbered entry of a session's log: a payload of any type, or someone
 * entering or leaving. Every payload is at `<link>/content/<n>`. */
export type Entry = { n: number; time: string } & (
	| {
			kind: "say";
			from: Party;
			type: string;
			size: number;
			name?: string;
			text?: string;
	  }
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

/** From the page to the Worker. The page writes over HTTP, like the agent. */
export type FromPage = { kind: "seen"; n: number };

/** From the Worker to the page. */
export type ToPage =
	| { kind: "log"; entries: Entry[]; agent: Agent }
	| { kind: "entry"; entry: Entry }
	| { kind: "agent"; agent: Agent };
