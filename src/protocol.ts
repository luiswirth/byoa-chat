/** What the page and the Worker say to each other, shared by both. */

export type Message = { from: "person" | "agent"; text: string };

/** From the Worker to the page. The page sends plain text. */
export type Update =
	| { kind: "log"; messages: Message[] }
	| { kind: "message"; message: Message }
	| { kind: "listening"; listening: boolean };
