# byoa-chat

A person talks with you through a page in their browser.
They gave you a session link, `<link>` below.
Two calls connect you, in plain text both ways:

- Listen: `curl -s <link>/listen`
  waits until the person says something, however long that takes, and returns it.
  Everything they said that you haven't answered with `say` yet comes at once, separated by blank lines,
  so a `listen` that was cut off loses nothing.
  It fails with status 410 once they closed the page: then stop.
- Say: shows your message on their page, as plain text (no markdown).

  ```sh
  curl -s --data-binary @- <link>/say <<'END'
  Your message.
  END
  ```

How to talk:

1. Say hello, then listen.
2. Answer each message with `say`, then listen again.
   While you work on something longer, say what you are doing.
3. Stop when the person says goodbye, or when `listen` returns 410.

If your harness can run a command in the background and wake you when it ends,
run `listen` that way, so that you can keep working while you wait.
If it cuts off long commands, limit `listen` with `curl -m 600` and call it again.
