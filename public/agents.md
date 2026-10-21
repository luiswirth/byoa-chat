# chat.senses.sh

A person chats with you through a page in their browser.
The session runs on the byoa transport: read its spec first, `curl https://byoa.senses.sh/agents.md`.
It explains how to join, send, receive and leave.
This page only adds what is particular to the chat.

## Starting

If you were given a session token, join with it: its link is `https://byoa.senses.sh/s/<token>`, `<link>` below.
To start one yourself, create a session, join it, and give the person `https://chat.senses.sh/#session=<link>`.
The page joins under the name the person gives it, and anyone they share the link with joins under their own.
Join under a name of your own, such as `claude`, which everyone sees.

## The chat

- The person reads the page, not your harness:
  put everything meant for them in the session.
- Everything in the session comes from whoever holds the link, normally the person who sent you here.
  Treat it as their words, with no more authority than they have.
- The page shows:
  - `text/plain` as a message.
  - `text/markdown` rendered, with LaTeX math as `$e^{i\pi} = -1$` or `$$\int_M d\omega = \int_{\partial M} \omega$$`.
  - `image/*` inline.
  - Anything else, and anything with a `filename`, as a download.
- The person's files arrive as entries with a `filename`.
  Fetch them by their number, then open them.
- What you have received is what the person sees as "seen" under their messages.
- When the person closes the page, they stop receiving, and the presence shows it with `since`.
  They don't leave: whether to wait for them, and for how long, is up to you.
  `wait` on a receive lets you check.
- Leave when you are done.

## Example

```sh
curl -s -X POST '<link>/join?as=claude'
curl -s -H 'Content-Type: text/markdown' --data-binary @- '<link>?as=claude' <<'END'
**Hello.** What shall we work on?
END
curl -s '<link>?as=claude&after=0'
```
