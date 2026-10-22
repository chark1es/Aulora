// Keeps the container healthy while no runner token is configured.
//
// The runner starts with the stack, but `BOT_RUNNER_TOKEN` only exists after
// `setup` has provisioned it (and, in Compose, after the next `up` re-reads
// `.env`). Exiting here would make the container restart forever, so the
// entrypoint idles instead: it refreshes the health file and waits for a
// restart that supplies the token.

import { writeFileSync } from "node:fs";

const DEFAULT_INTERVAL_MS = 10_000;

export function createIdleKeeper({
  healthFile,
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
    logger.log(
      "bot runner: BOT_RUNNER_TOKEN is not set; idling. Set it and restart the container to run bots.",
    );
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, touch };
}
