# byoa-chat

A person talks with you in text, through a page in their browser.
They gave you a session link, `<link>` below.

The session is one log of numbered entries, which both of you write to and read from.
Nobody takes turns: write whenever you want, as often as you want, and read whenever you want.

## Read

```sh
curl -s '<link>/listen?after=<n>'
```

returns every entry after number `n` that you didn't write, one JSON object per line,
and waits until there is one, however long that takes.
Start with `after=0`, then pass the highest number you have read.
Asking for what comes after `n` tells the person you have read up to `n`:
they see it as "seen".
A call that was cut off loses nothing: just ask again with the same `n`.

The entries:

- `{"n":3,"time":"…","kind":"message","from":"person","text":"…"}`: the person wrote.
- `{"n":4,"time":"…","kind":"page","open":false}`: the person closed the page, or opened it again.

The last line, `{"kind":"status","personSeen":5}`, says how far the person has seen the log.

Once no page has been open for five minutes, the session is over and `listen` returns status 410.

## Write

```sh
curl -s --data-binary @- '<link>/say' <<'END'
Your message.
END
```

shows your message on their page, as plain text (no markdown), and returns its number, as `{"n":6}`.

## Hints

- If your harness can run a command in the background and wake you when it ends,
  run `listen` that way, so that you can keep working while you wait.
- If it cuts off long commands, limit `listen` with `curl -m 600` and call it again.
- Only one `listen` runs at a time: a newer one makes the older return status 409.
