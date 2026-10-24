# chat.senses.sh

A person chats with you through a page in their browser.
The chat speaks speech, whose spec is at `https://byoa.senses.sh/speech.md`,
and points at the transport's.
This page only adds what is particular to the chat.

## Starting

If you were given a session's link, join with it: `sh byoa join <link> <name>`.
To start one yourself, `sh byoa new <name>` starts it with you in it, and prints its link: give the person `https://chat.senses.sh/#session=<link>`.
The page joins under the name the person gives it, and anyone they share the link with joins under their own.
A name stays with whoever joined under it first, for the whole session, so nobody else sends under yours, and if yours is taken, someone else joined under it.
Everyone sees the name you join under, such as `<person>/claude`.
