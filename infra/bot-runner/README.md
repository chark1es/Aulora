# Aulora bot runner

The bot runner supervises user-created **bots**: small TypeScript or Python
programs stored in Convex and run, one process each, in a locked-down
`bot-runner` container. A bot acts like a member with its own identity and can
only do what an admin granted it. The binding contract is
[`docs/bots-design.md`](../../docs/bots-design.md).

Plain Node ESM, no dependencies, Node ≥ 22. Tests run with `node --test`.

## What it does

Every `BOT_RUNNER_POLL_INTERVAL_MS` (default 3 s) it:

1. calls `GET /bots/runner/desired` (enabled bots only);
2. reconciles: starts missing bots (up to `BOT_RUNNER_MAX_BOTS`), stops bots
   that were removed or disabled, and relaunches a bot whose `revision` or
   `restartNonce` changed;
3. relaunches a crashed bot after an exponential backoff (1 s … 60 s, reset
   once it stayed up for 60 s).

Per launch it fetches the bundle, writes the files to `/work/<botId>/`,
mints a hosted credential (`POST /bots/runner/credential`), optionally installs
dependencies, and spawns the bot. It reports `starting`/`running`/`crashed`/
`stopped` to `POST /bots/runner/report` and ships stdout/stderr in batches to
`POST /bots/runner/logs` (≤ 200 lines, clipped to 4 KiB, flushed every 1 s).

On `SIGTERM`/`SIGINT` it sends `SIGTERM` to every bot's process group, waits
5 s, then `SIGKILL`s, reports `stopped` and removes the work directories.

## Security model

- **Fresh environment.** A bot never inherits the runner's environment and in
  particular never sees `BOT_RUNNER_TOKEN`. It gets exactly `AULORA_TOKEN`,
  `AULORA_SITE_URL`, `AULORA_CONVEX_URL`, `AULORA_BOT_ID`,
  `AULORA_BOT_USER_ID`, `AULORA_BOT_NAME`, its own env vars, `PATH`,
  `HOME=/work/<botId>`, `LANG` (plus `PYTHONPATH` for Python, `NODE_OPTIONS`
  with `--max-old-space-size` for TypeScript).
- **Own uid/gid.** When the supervisor runs as root (the compose default), each
  bot gets a deterministic uid/gid (`BOT_RUNNER_UID_BASE` + a per-bot slot) and
  its directory is chowned to it, mode 0700. Locally (non-root) bots run as the
  current user so tests and development work.
- **Resource limits.** `prlimit` caps `nproc`, address space
  (`BOT_RUNNER_BOT_MEMORY_MB`) and file size; TypeScript bots also get a V8 heap
  cap. The container's `mem_limit`, `cpus` and `pids_limit` are the backstop.
- **Path safety.** Bundle file paths are validated against `BOT_LIMITS` and
  resolved under the bot directory; anything that escapes it is refused.
- **No secrets in logs.** The runner token is only ever sent as an
  `Authorization` header and is never logged or passed to a bot.

### Limits of the sandbox

This is **container-level isolation, not a VM**. Bots run as separate users in
the same container and can use the network (that is how they call Convex). A
kernel or runtime escape, or a network service reachable from the `bots`
network, is in scope for a malicious bot. The `bots` network is shared only
with `convex-backend`, so a bot cannot reach Postgres, MinIO or the web
container. Treat `ManageBots` like code execution on the server and grant it
accordingly.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_RUNNER_TOKEN` | – | Shared secret for `/bots/runner/*` (required) |
| `CONVEX_HTTP_URL` | `http://convex-backend:3211` | Convex HTTP-actions origin |
| `CONVEX_SELF_HOSTED_URL` | `http://convex-backend:3210` | Convex API origin given to bots |
| `BOT_RUNNER_MAX_BOTS` | `10` | Concurrent bot processes |
| `BOT_RUNNER_BOT_MEMORY_MB` | `256` | Per-bot memory cap |
| `WORK_DIR` | `/work` | tmpfs holding each bot's directory |
| `BOT_SDK_TS_DIR` | `/opt/aulora/bot-sdk` | Built `@aulora/bot` package |

Advanced knobs: `BOT_RUNNER_POLL_INTERVAL_MS`, `BOT_RUNNER_LOG_FLUSH_MS`,
`BOT_RUNNER_LOG_BATCH_LINES`, `BOT_RUNNER_LOG_LINE_BYTES`,
`BOT_RUNNER_DEP_TIMEOUT_MS`, `BOT_RUNNER_BACKOFF_BASE_MS`,
`BOT_RUNNER_BACKOFF_MAX_MS`, `BOT_RUNNER_UPTIME_RESET_MS`,
`BOT_RUNNER_SHUTDOWN_GRACE_MS`, `BOT_RUNNER_UID_BASE`,
`BOT_RUNNER_HEALTH_FILE`, plus the `BOT_RUNNER_PYTHON`/`PIP`/`NPM`/`TSX`/`PATH`
overrides used by the tests.

## Development

```sh
node --test "test/*.test.mjs"   # fake Convex server + real child processes
node src/main.mjs               # requires BOT_RUNNER_TOKEN
```

The tests spin up a fake Convex HTTP server that implements the five runner
routes and run real Node processes as bot code. No network or Docker needed.
