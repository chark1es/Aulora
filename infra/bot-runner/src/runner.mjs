// Wires the API client, log shipper and reconciler into the poll loop.
//
// `tick()` is exposed so tests can drive reconciliation deterministically; in
// production `start()` runs it every `BOT_RUNNER_POLL_INTERVAL_MS`.

import { writeFileSync } from "node:fs";
import { pollDelayMs } from "./config.mjs";
import { createLogShipper } from "./logs.mjs";
import { createReconciler } from "./reconciler.mjs";

export function createRunner({ config, api, logger = console, now = Date.now }) {
  const shipper = createLogShipper({
    post: (botId, lines) => api.logs(botId, lines),
    now,
    flushIntervalMs: config.logFlushIntervalMs,
    maxBatchLines: config.logBatchLines,
    maxLineBytes: config.logLineBytes,
  });
  const reconciler = createReconciler({ config, api, shipper, logger, now });
  let timer = null;
  let healthTimer = null;
  let started = false;
  let stopped = false;

  function touchHealth() {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- config.healthFile is the runner's own heartbeat path (BOT_RUNNER_HEALTH_FILE), a fixed container path from validated config.
      writeFileSync(config.healthFile, String(now()));
    } catch {
      // The health file lives on tmpfs in the image; missing in unit tests.
    }
  }

  async function tick() {
    try {
      const desired = await api.desired();
      await reconciler.reconcile(desired);
    } catch (error) {
      logger.warn?.(`bot runner: poll failed: ${error.message}`);
    }
    touchHealth();
  }

  // A tracked bot (running, launching or waiting on a restart backoff) keeps
  // the active cadence so a relaunch is not delayed by the idle interval.
  function nextDelay() {
    return pollDelayMs({
      active: reconciler.snapshot().length > 0,
      activeMs: config.pollIntervalMs,
      idleMs: config.pollIdleIntervalMs,
      jitter: config.pollJitter,
    });
  }

  function start() {
    if (started || stopped) return;
    started = true;
    touchHealth();
    // The healthcheck rejects heartbeats older than ~30 s. The idle reconcile
    // cadence can be longer, so refresh the liveness file independently.
    healthTimer = setInterval(touchHealth, Math.min(config.pollIntervalMs, 10_000));
    healthTimer.unref?.();
    const loop = async () => {
      await tick();
      if (!stopped) timer = setTimeout(loop, nextDelay());
    };
    void loop();
  }

  async function stop() {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (healthTimer !== null) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    await reconciler.shutdown();
    shipper.stop();
  }

  return { start, stop, tick, reconcile: reconciler.reconcile, snapshot: reconciler.snapshot };
}
