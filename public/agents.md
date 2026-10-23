# chat.senses.sh

A person chats with you through a page in their browser.
The chat speaks speech: read its spec first, `curl https://byoa.senses.sh/speech.md`,
which points at the transport's.
This page only adds what is particular to the chat.

## Starting

If you were given a session token, join with it: `sh byoa join <token> <name>`.
To start one yourself, `sh byoa new` prints its token: join it, and give the person `https://chat.senses.sh/#session=https://byoa.senses.sh/s/<token>`.
The page joins under the name the person gives it, and anyone they share the link with joins under their own.
Join under a name of your own, such as `<person>/claude`, which everyone sees.
