/** What the page and the Worker say to each other, shared by both. */

export type Party = "person" | "agent";

/** One numbered entry of a session's log: a message, or something worth
 * knowing. */
export type Entry = { n: number; time: string } & (
	| { kind: "message"; from: Party; text: string }
	| { kind: "page"; open: boolean }
);

/** How far the agent has read, and whether it is waiting to hear more. */
export type Agent = { seen: number; listening: boolean };

/** From the page to the Worker. */
export type FromPage =
	| { kind: "say"; text: string }
	| { kind: "seen"; n: number };

/** From the Worker to the page. */
export type ToPage =
	| { kind: "log"; entries: Entry[]; agent: Agent }
	| { kind: "entry"; entry: Entry }
	| { kind: "agent"; agent: Agent };
