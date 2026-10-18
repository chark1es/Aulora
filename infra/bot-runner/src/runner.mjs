// Wires the API client, log shipper and reconciler into the poll loop.
//
// `tick()` is exposed so tests can drive reconciliation deterministically; in
// production `start()` runs it every `BOT_RUNNER_POLL_INTERVAL_MS`.

import { writeFileSync } from "node:fs";
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
  let stopped = false;

  function touchHealth() {
    try {
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

  function start() {
    if (timer !== null || stopped) return;
    const loop = async () => {
      await tick();
      if (!stopped) timer = setTimeout(loop, config.pollIntervalMs);
    };
    void loop();
  }

  async function stop() {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await reconciler.shutdown();
    shipper.stop();
  }

  return { start, stop, tick, reconcile: reconciler.reconcile, snapshot: reconciler.snapshot };
}
