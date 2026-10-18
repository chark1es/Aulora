# aulora-bot

The Python SDK for Aulora bots. It uses only the standard library (Python 3.10+),
talks to the same Convex functions people use, and receives events over the
polling transport.

## Install

```bash
pip install aulora-bot
```

For this checkout:

```bash
python3 -m pip install packages/bot-sdk-python
```

## Hello bot

This is the `hello` template: reply `pong` to `!ping`, and react when the bot is
mentioned.

```python
from aulora_bot import Bot

bot = Bot()


@bot.on("message")
async def on_message(message):
    if message.body.strip() == "!ping":
        await message.reply("pong")
    if message.mentions_me:
        await message.react("👋")


bot.run()
```

`run()` blocks until the process receives `SIGTERM` or `SIGINT`. If you already
own an asyncio loop, use `await bot.start()` and `await bot.stop()` instead.

## Configuration

Explicit constructor options override the environment:

| Option | Environment | Meaning |
| --- | --- | --- |
| `token` | `AULORA_TOKEN` | Bot API token (`abt_...`), or the hosted token injected by the runner. |
| `site_url` | `AULORA_SITE_URL` | Convex **site** origin; the SDK posts to `{site_url}/bots/token`. |
| `convex_url` | `AULORA_CONVEX_URL` | Convex deployment URL; the SDK calls `{convex_url}/api/{query,mutation,action}`. |
| `poll_interval` | – | Seconds between polls (default `1.0`). |
| `include_self` | – | Deliver the bot's own events too (default `False`). |
| `timeout` | – | Per-request timeout in seconds (default `30`). |

```python
bot = Bot(
    token="abt_...",
    site_url="https://chat.example.com",
    convex_url="https://happy-otter-123.convex.cloud",
)
```

All URLs are validated and normalized when the bot is constructed. A trailing
slash is allowed; credentials, query strings and fragments are rejected.

## Events

Register handlers with `bot.on(name)` as a decorator, or
`bot.on(name, handler)` directly. Handlers may be plain functions or `async`
functions.

| Event | Aliases | Handler receives |
| --- | --- | --- |
| `ready` | – | `Me` (`user_id`, `name`) |
| `message` | `message.created` | `Message` |
| `message_update` | `messageUpdate`, `message.updated` | `Message` |
| `message_delete` | `messageDelete`, `message.deleted` | `Message` (`body` is empty) |
| `reaction_add` | `reactionAdd`, `reaction.added` | `Reaction` (`message_id`, `user_id`, `emoji`, `channel_id`) |
| `reaction_remove` | `reactionRemove`, `reaction.removed` | `Reaction` |
| `error` | – | `Exception` |

Events caused by the bot itself (`event.self_ is True`) are skipped unless the
bot was created with `include_self=True`. An exception in a handler is logged
and sent to the `error` handlers; it never stops the poll loop.

`Message` exposes `id`, `channel_id`, `author_id`, `body`, `thread_root_id`,
`reply_to_id`, `mention_user_ids`, `created_at`, `edited_at`, `deleted_at`,
`attachment_ids`, and `mentions_me`, plus helpers:

```python
reply = await message.reply("pong")  # messages:send with replyToId; returns a Message
await message.react("👍")             # reactions:toggle
await message.edit("new text")       # messages:edit; updates message.body
await message.delete()               # messages:remove
```

`reply` returns the new `Message` and stays inside the same thread when the
message is a thread reply. `edit` updates the local `message.body` on success.

## Client reference

```python
bot.me                         # Me | None, known after the token exchange
await bot.channels.list()      # every visible channel, pagination followed
await bot.messages.list(channel_id, limit=50)   # newest page, oldest first
await bot.messages.send(channel_id, body, reply_to_id=None, thread_root_id=None)  # -> Message
await bot.messages.edit(message_id, body)
await bot.messages.delete(message_id)
await bot.reactions.add(message_id, emoji)
await bot.reactions.remove(message_id, emoji)
await bot.members.list()
await bot.call("module:function", {"arg": 1}, kind="query")  # escape hatch
```

The method-to-function mapping is:

| Method | Convex function |
| --- | --- |
| `channels.list()` | `channels:list` |
| `messages.list()` | `messages:list` |
| `messages.send()` | `messages:send` |
| `messages.edit()` | `messages:edit` |
| `messages.delete()` | `messages:remove` |
| `reactions.add()` / `.remove()` | `reactions:toggle` |
| `members.list()` | `members:list` |
| `call()` | any `module:function` (`query`, `mutation`, or `action`) |

`messages.list()` returns the newest page, oldest first, matching the server's
pagination behavior. `channels.list()` follows `continueCursor` until
`isDone`, so it returns the complete list.

The server exposes reactions as a single idempotent `reactions:toggle`, so
`reactions.add()` and `reactions.remove()` call it and, when the toggle flips the
wrong way, call it a second time to correct the state. This matches the
TypeScript SDK.

## Permissions

Every bot starts with **no permissions**. An administrator grants them in
Workspace settings → Bots → Permissions. The server enforces the same checks it
enforces for a person, so an unpermitted call fails with `AuloraError`:

```python
from aulora_bot import AuloraError

try:
    await bot.messages.send(channel_id, "hello")
except AuloraError as error:
    print(error.message)  # e.g. "Missing permission"
    print(error.code)     # server code, when supplied
    print(error.data)     # structured errorData, when supplied
```

`AuloraError` also exposes `status` (the HTTP status, when the failure came from
an HTTP response). Permission failures, disabled bots, invalid tokens, rate
limits and malformed requests all use this type.

## Polling latency and retention

The SDK polls `botEvents:poll` every `poll_interval` seconds (default 1), so a
handler normally runs within about a second of the event. After any poll error
the loop waits 5 seconds, keeps the cursor, and retries; it never has two polls
in flight.

The server retains bot events for **one hour**. If the bot is stopped longer than
that, events from the gap are lost, and a fresh start begins at "now". The cursor
is held in memory only, so restarting the bot also begins at "now" rather than
replaying old events.

## Running outside the bot runner

Hosted bots receive `AULORA_TOKEN`, `AULORA_SITE_URL` and `AULORA_CONVEX_URL`
from the runner. To run the same code on another machine:

1. Open Workspace settings → Bots → your bot → Token and create an API token
   (`abt_...`). The token is shown once.
2. Export the variables:

   ```bash
   export AULORA_TOKEN="abt_..."
   export AULORA_SITE_URL="https://chat.example.com"
   export AULORA_CONVEX_URL="https://happy-otter-123.convex.cloud"
   python3 main.py
   ```

3. Rotating or revoking the token invalidates the old one immediately. The SDK
   exchanges the token for a one-hour JWT and refreshes it five minutes before
   expiry (and once after an authentication failure).

## Development

```bash
PYTHONPATH=packages/bot-sdk-python/src \
  python3 -m unittest discover -s packages/bot-sdk-python/tests -t packages/bot-sdk-python
python3 -m compileall -q packages/bot-sdk-python/src
```

The tests use only the standard library and a local fake HTTP server.

## License

PolyForm-Noncommercial-1.0.0. See the repository root `LICENSE` file.
