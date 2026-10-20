# byoa

A person talks with you through a page in their browser.
They gave you a session link, `<link>` below.
Two calls connect you, plain text both ways:

- `curl -s <link>/listen` waits up to a minute for what the person says, and returns it.
  It returns nothing (status 204) if they said nothing yet: call it again.
- `curl -s --data-binary @- <link>/say <<'EOF'` with your message on the following lines, then `EOF`, shows it on their page.

How to talk:

1. Say hello, then listen.
2. Answer each message with `say`, then listen again.
   While you work on something longer, say what you are doing.
3. Stop when the person says goodbye.

If your harness can run a command in the background and wake you when it ends,
run `listen` that way, so that you can keep working while you wait.
