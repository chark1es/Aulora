# @aulora/bot

TypeScript SDK for Aulora bots. It exchanges a bot API token for a short-lived
JWT, polls the bot event feed, and calls the same Convex functions a member
uses — as the bot's own identity.

## Install

```sh
bun add @aulora/bot
# or: npm install @aulora/bot
```

Requires Node 22 or newer (Node 24 is what the bot runner ships).

## Quick start

The `hello` template: answer `!ping` with `pong` and wave at mentions.

```ts
import { Bot } from "@aulora/bot";

const bot = new Bot();

bot.on("message", async (message) => {
  if (message.mentionsMe) {
    await message.react("👋");
  }
  if (message.body.trim() === "!ping") {
    await message.reply("pong");
  }
});

bot.start();
```

## Configuration

Constructor options override `AULORA_*` environment variables.

| Option | Environment | Meaning |
| --- | --- | --- |
| `token` | `AULORA_TOKEN` | Bot API token (`abt_...`). Required. |
| `siteUrl` | `AULORA_SITE_URL` | Convex site origin serving `POST /bots/token`. Required. |
| `convexUrl` | `AULORA_CONVEX_URL` | Convex deployment origin serving `/api/query|mutation|action`. Required. |
| `pollIntervalMs` | – | Event poll interval (default `1000`). |
| `includeSelf` | – | Deliver the bot's own events (default `false`). |
| `handleSignals` | – | Stop on SIGTERM/SIGINT (default `true`). |

The runner also sets `AULORA_BOT_ID`, `AULORA_BOT_USER_ID` and
`AULORA_BOT_NAME`; the SDK uses them for `bot.me` until the first token
exchange.

```ts
const bot = new Bot({
  token: "abt_...",
  siteUrl: "https://my-deployment.convex.site",
  convexUrl: "https://my-deployment.convex.cloud",
  pollIntervalMs: 1000,
});
```

## Events

`bot.on(event, handler)` returns the bot, so handlers can be chained. `handler`
may be sync or async; a throwing or rejecting handler is routed to the `error`
event and never crashes the process. Events whose `self` is `true` are skipped
unless `includeSelf` is set.

| Event | Payload | Fired for |
| --- | --- | --- |
| `ready` | `BotIdentity` (`{ userId, name, botId? }`) | Once, after the first successful poll. |
| `message` | `Message` | `message.created`. |
| `messageUpdate` | `Message` | `message.updated`. |
| `messageDelete` | `Message` (empty `body`) | `message.deleted`. |
| `reactionAdd` | `ReactionEvent` | `reaction.added`. |
| `reactionRemove` | `ReactionEvent` | `reaction.removed`. |
| `error` | `Error` | Polling/transport failures and handler exceptions. |

`ReactionEvent` is `{ messageId, channelId, userId, emoji, self }`.

```ts
bot.on("error", (error) => console.error("bot error", error));
```

## Methods

| Member | Description |
| --- | --- |
| `bot.me` | The bot's identity (`{ userId, name, botId? }`) or `null` before it is known. |
| `bot.start()` | Starts polling; resolves when `stop()` is called or a signal arrives. |
| `bot.stop()` | Stops polling, clears timers and signal handlers. |
| `bot.channels.list()` | Every channel the bot may see (walks all pages). |
| `bot.messages.list(channelId, { limit? })` | Recent messages, oldest first. |
| `bot.messages.send(channelId, body, { replyToId?, threadRootId? })` | Sends a message and returns it. |
| `bot.messages.edit(messageId, body)` | Edits a message. |
| `bot.messages.delete(messageId)` | Soft-deletes a message. |
| `bot.reactions.add(messageId, emoji)` | Adds the bot's reaction. |
| `bot.reactions.remove(messageId, emoji)` | Removes the bot's reaction. |
| `bot.members.list()` | Workspace members. |
| `bot.call(path, args?, kind?)` | Escape hatch for any Convex function (`kind` = `"query"` \| `"mutation"` \| `"action"`). |

`.add`/`.remove` are idempotent: they call `reactions:toggle` and correct the
toggle if the bot's reaction state did not match.

### `Message`

`Message` exposes `id`, `channelId`, `authorId`, `body`, `threadRootId`,
`replyToId`, `mentionUserIds`, `createdAt`, `editedAt`, `deletedAt` and
`mentionsMe`, plus:

| Helper | Description |
| --- | --- |
| `message.reply(body)` | Sends a reply; stays inside the thread for thread replies. |
| `message.react(emoji)` | Adds a reaction to this message. |
| `message.edit(body)` | Edits this message. |
| `message.delete()` | Deletes this message. |

## Errors

Every rejection is an `AuloraError` with `message`, `code`, `data` and `status`:

```ts
import { AuloraError } from "@aulora/bot";

try {
  await bot.messages.send(channelId, "hi");
} catch (error) {
  if (error instanceof AuloraError && error.code === "convex_error") {
    console.error(error.message); // e.g. "Missing permission"
  }
}
```

Permission and state errors:

* A bot starts with **no permissions**. An admin grants them in Workspace
  settings → Bots → Permissions; a call the bot cannot make rejects with
  `Missing permission` from the server.
* `invalid_token` — the API token was revoked or is wrong.
* `bot_disabled` — an admin disabled the bot.
* `bots_unavailable` — the deployment has no bot JWT keys configured.
* Rate limiting returns `429`; the token endpoint allows 60 requests/minute per
  token.

Queries retry transient network and 5xx failures with backoff; mutations and
actions never retry.

## Polling and event retention

* Events are polled with `botEvents:poll` every `pollIntervalMs` (default 1s).
  Only one poll is in flight at a time.
* On a polling error the SDK waits 5 seconds before retrying and emits `error`.
* Events older than **1 hour** are pruned server-side. A bot that is offline
  longer than that misses them, and a `null` first cursor starts from "now".
* Keep the process alive with `await bot.start()`; it resolves on `stop()` or
  SIGTERM/SIGINT (unless `handleSignals: false`).

## Running a bot outside the server

The hosted runner is optional — the SDK is a normal Node library.

1. In Workspace settings → Bots, enable the bot and grant the permissions it
   needs (for example `ViewChannel`, `ReadHistory`, `SendMessages`,
   `AddReactions`).
2. Open the bot's Token tab and create an API token. It is shown once; store it
   as a secret.
3. Run your script with the three environment variables:

```sh
export AULORA_TOKEN="abt_..."
export AULORA_SITE_URL="https://my-deployment.convex.site"
export AULORA_CONVEX_URL="https://my-deployment.convex.cloud"
npx tsx main.ts
```

`Ping`/`Pong` permissions are not implicit: without `SendMessages` the reply
rejects with `Missing permission`.
