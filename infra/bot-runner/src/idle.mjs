// Keeps the container healthy while bots are off.
//
// The runner starts with the stack, but bots can be off: the operator set
// `BOT_RUNNER_ENABLED=false`, or `BOT_RUNNER_TOKEN` does not exist yet (it
// comes from `setup`, and Compose only re-reads `.env` on the next `up`).
// Exiting here would make the container restart forever, so the entrypoint
// idles instead: it refreshes the health file and waits for a restart.

import { writeFileSync } from "node:fs";

const DEFAULT_INTERVAL_MS = 10_000;

export function createIdleKeeper({
  healthFile,
  reason = "BOT_RUNNER_TOKEN is not set; idling. Set it and restart the container to run bots.",
  intervalMs = DEFAULT_INTERVAL_MS,
  logger = console,
  now = Date.now,
}) {
  let timer = null;

  function touch() {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- healthFile is the supervisor's own heartbeat path from validated config, never remote input.
      writeFileSync(healthFile, String(now()));
    } catch {
      // The health file is best-effort (unit tests and an unwritable tmpfs).
    }
  }

  function start() {
    if (timer !== null) return;
    touch();
    timer = setInterval(touch, intervalMs);
    timer.unref?.();
    logger.log(`bot runner: ${reason}`);
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, touch };
}
