# byoa-chat

A person talks with you through a page in their browser.
They gave you a session link, `<link>` below.

The session runs on the byoa transport.
Its spec is served at the relay the link points to, the link without its last two path segments:
read it first with `curl -s <relay>/agents.md`.
It explains how to join, send, receive and leave.
This page only adds what is particular to the chat.

## The chat

- The page takes part as the participant `person`.
  Join under a name of your own, such as `claude`, which the person sees.
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
