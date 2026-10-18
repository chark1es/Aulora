# Bots

Bots are programs you write in TypeScript or Python that join your workspace and act like a member: they read messages, send, edit and delete them, add reactions and more. They run on your own server, inside a separate `bot-runner` container. A bot has **no permissions until an admin grants them**.

Bots are managed on the web app in **Workspace settings → Bots**, which needs the Manage bots permission. Bot messages appear in channels like any other message, with a BOT badge.

> **Treat Manage bots like code execution on your server.** Bot code runs in the bot runner container as an unprivileged user with its own directory and resource limits, but that is container-level isolation, not a virtual machine, and bots can reach the network. Give Manage bots only to people you would trust to run code on the host. Bots cannot be given Administrator, Manage roles, Manage workspace, Manage bots, invite permissions or View audit log.

## Turn it on

Bots need the bot runner, which is an optional container. Run `setup` once so it generates the bot signing key and runner secret, then start the runner with the `bots` profile:

```bash
docker compose run --rm setup
docker compose --profile bots up -d --build
```

Until the runner is up, **Workspace settings → Bots** shows a banner saying so and bots stay stopped. On Coolify, set `BOT_RUNNER_TOKEN` to a random string of at least 48 characters in the environment first, then run the runner from the host with `--profile bots`. See the Bots section of the [Docker README](https://github.com/chark1es/Aulora/blob/main/infra/docker/README.md#bots-optional) for the sandbox model and tuning variables.

## Create a bot

1. Open **Workspace settings → Bots** and choose **New bot**.
2. Pick a name, a language and a template. **Hello bot** replies `pong` to `!ping` and reacts with a wave when mentioned. **Blank** is an empty connected skeleton.
3. Open the **Permissions** tab and grant what the bot needs. A new bot can do nothing, not even see channels.
4. Turn the bot on from the list or the **Overview** tab. The runner starts it within a few seconds and the status dot turns green.

The detail view has six tabs:

| Tab | Use |
| --- | --- |
| Overview | Enable, restart, rename, change language, delete |
| Code | Edit the bot's files, up to 50 files, 256 KiB each and 1 MiB in total |
| Permissions | Grant permissions and limit the bot to chosen channels |
| Environment | Set secrets and settings as environment variables |
| Logs | The bot's recent output, newest 500 lines |
| Token | Create an API token for a bot that runs somewhere else |

Saving code restarts the bot with the new files. Deleting a bot keeps the messages it sent.

## Permissions

Bots do not inherit the `@everyone` role. A bot holds exactly the permissions you tick, further narrowed by any channel overrides, and optionally by a channel list. Choose **Only selected channels** to confine a bot to those channels no matter what it has been granted.

You can only grant a bot permissions you hold yourself, and you can only edit the code, environment or token of a bot whose permissions you could grant. This stops Manage bots from becoming a way around your own limits. Disabling or deleting a bot is always allowed. A disabled bot stops immediately, even if it still holds a valid session.

Browsing the workspace, such as listing members, roles and categories, also needs View channel. A bot can never start direct messages or upload an avatar, though people can message a bot directly.

The usual set for a chat bot is View channel, Read history and Send messages. Add Add reactions for reactions and Manage messages to delete other people's messages. Mention everyone, Kick, Ban and Timeout work but deserve extra care.

## Write a bot

Both SDKs poll for new events about once a second, so a reply arrives about a second after a message. Events are kept for one hour, so a bot that is offline for longer misses what happened meanwhile. The SDKs are preinstalled in the runner.

### TypeScript

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

The entry file is `main.ts`. It runs with `tsx`, so modern TypeScript works without a build step.

### Python

```python
from aulora_bot import Bot

bot = Bot()


async def on_message(message):
    if message.mentions_me:
        await message.react("👋")
    if message.body.strip() == "!ping":
        await message.reply("pong")


bot.on("message", on_message)
bot.run()
```

The entry file is `main.py`. Handlers can be plain functions or `async` functions.

### What a bot can do

| Event | When |
| --- | --- |
| `ready` | The bot connected |
| `message` | A message was sent |
| `messageUpdate`, `messageDelete` | A message was edited or deleted (`message_update`, `message_delete` in Python) |
| `reactionAdd`, `reactionRemove` | A reaction was added or removed (`reaction_add`, `reaction_remove` in Python) |
| `error` | A handler failed. A failing handler never stops the bot |

A bot only receives events from channels where it holds View channel and Read history, and never sees the body of a deleted message. Its own actions are skipped unless you pass `includeSelf` (`include_self` in Python).

The `bot` object also offers `channels.list()`, `messages.list()`, `messages.send()`, `messages.edit()`, `messages.delete()`, `reactions.add()`, `reactions.remove()`, `members.list()` and `call()` for any other Convex function. A call the bot is not permitted to make fails with the server's message, such as `Missing permission`. The SDK READMEs list every method: [TypeScript](https://github.com/chark1es/Aulora/blob/main/packages/bot-sdk/README.md) and [Python](https://github.com/chark1es/Aulora/blob/main/packages/bot-sdk-python/README.md).

### Dependencies and secrets

Put a `requirements.txt` (Python) or a `package.json` (TypeScript) in the bot's files and the runner installs them when the bot starts, with a two minute limit. npm lifecycle scripts are disabled. Install failures show in the Logs tab.

Never put secrets in code. Add them in the **Environment** tab. Values are encrypted at rest, are never shown again after saving, and reach the bot as environment variables. Names must be upper case and cannot start with `AULORA_`.

## Run a bot somewhere else

The **Token** tab creates an API token. A bot using it works from any machine that can reach your server; set `AULORA_TOKEN`, `AULORA_SITE_URL` and `AULORA_CONVEX_URL` and use the same SDK. The token is shown once, so copy it immediately. Creating a new one replaces the old one, and revoking it cuts that bot off. The bot must still be enabled. Bots hosted by the runner do not need a token.

## Limits

| Limit | Value |
| --- | --- |
| Bots per workspace | 25 |
| Files per bot | 50, 256 KiB each, 1 MiB total |
| Environment variables | 32, 4 KiB each |
| Running at once | 10 by default (`BOT_RUNNER_MAX_BOTS`) |
| Memory per bot | 256 MiB by default (`BOT_RUNNER_BOT_MEMORY_MB`) |
| Messages | The normal send rate limit applies to bots too |
