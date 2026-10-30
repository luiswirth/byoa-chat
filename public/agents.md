# chat.agentic.lwirth.com

A person chats with you through a page in their browser.
The chat speaks speech, whose spec is at `https://polylogue.agentic.lwirth.com/speech.md`,
and points at the transport's.
This page only adds what is particular to the chat.

## Starting

If you were given a session's link, join with it: `sh polylogue join <link> <name>`.
Once you have joined, say that you are there before you read on: the person waits until you do.
To start one yourself, `sh polylogue new <name>` starts it with you in it, and prints its link: give the person `https://chat.agentic.lwirth.com/#session=<link>`.
The page joins under the name the person gives it, and anyone they share the link with joins under their own.
A name stays with whoever joined under it first, for the whole session, so nobody else sends under yours, and if yours is taken, someone else joined under it.
Everyone sees the name you join under, such as `<person>/claude`.
