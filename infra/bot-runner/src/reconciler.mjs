// Reconciliation loop: turn a desired-state list into running bot processes.
//
// One state entry per known bot. Each tick (every 3 s in production) the runner
// fetches the desired list and:
//   - starts bots that are missing (up to BOT_RUNNER_MAX_BOTS);
//   - stops bots that were removed or disabled;
//   - relaunches a bot when its `revision` or `restartNonce` changed;
//   - relaunches crashed bots after an exponential backoff (1 s..60 s, reset
//     once the process stayed up for 60 s).

import { join, resolve } from "node:path";
import { installDependencies } from "./deps.mjs";
import {
  botUidGid,
  detectPrlimit,
  linkTsSdk,
  signalBotGroup,
  spawnBot,
  UID_SLOT_COUNT,
  waitForExit,
} from "./launcher.mjs";
import { chownTree, isSafeBotId, removeBotDir, resetBotDir, writeBundleFiles } from "./store.mjs";

/**
 * Next backoff step after a crash. `crashCount` is the count before this crash;
 * a process that stayed up for `resetMs` restarts the sequence at `baseMs`.
 */
export function nextBackoff({ crashCount, uptimeMs, baseMs, maxMs, resetMs }) {
  const count = uptimeMs >= resetMs ? 1 : crashCount + 1;
  return { crashCount: count, delayMs: Math.min(maxMs, baseMs * 2 ** (count - 1)) };
}

function createState(desired, usePrlimit, uidSlot) {
  return {
    uidSlot,
    botId: desired.botId,
    meta: desired,
    revision: desired.revision,
    restartNonce: desired.restartNonce,
    child: null,
    status: "stopped",
    startedAt: 0,
    crashCount: 0,
    nextStartAt: null,
    stopping: false,
    usePrlimit,
  };
}

/**
 * Builds the reconciler. `install`, `spawnImpl` and `prlimit` are injectable so
 * tests can substitute fakes without spawning real processes.
 */
export function createReconciler({
  config,
  api,
  shipper,
  logger = console,
  now = Date.now,
  install = installDependencies,
  spawnImpl = spawnBot,
  prlimit = detectPrlimit(config),
}) {
  const bots = new Map();
  const workRoot = resolve(config.workDir);

  const botDir = (botId) => join(workRoot, botId);

  function runningCount() {
    let count = 0;
    for (const state of bots.values()) if (state.child) count += 1;
    return count;
  }

  async function report(botId, status, message) {
    try {
      await api.report(botId, status, message);
    } catch (error) {
      logger.warn?.(`bot ${botId}: report failed: ${error.message}`);
    }
  }

  async function terminate(state) {
    const child = state.child;
    if (!child) return;
    // An exit caused by this stop is not a crash: handleExit skips it.
    state.stopping = true;
    signalBotGroup(child, "SIGTERM");
    await waitForExit(child, config.shutdownGraceMs);
    if (child.exitCode === null && child.signalCode === null) {
      signalBotGroup(child, "SIGKILL");
    }
  }

  async function stopBot(state, { remove = false } = {}) {
    await terminate(state);
    state.child = null;
    state.stopping = false;
    state.status = "stopped";
    state.nextStartAt = null;
    await report(state.botId, "stopped");
    removeBotDir(botDir(state.botId));
    if (remove) bots.delete(state.botId);
  }

  function scheduleRestart(state) {
    const uptimeMs = state.startedAt ? now() - state.startedAt : 0;
    const { crashCount, delayMs } = nextBackoff({
      crashCount: state.crashCount,
      uptimeMs,
      baseMs: config.backoffBaseMs,
      maxMs: config.backoffMaxMs,
      resetMs: config.uptimeResetMs,
    });
    state.crashCount = crashCount;
    state.nextStartAt = now() + delayMs;
  }

  async function failLaunch(state, message) {
    state.child = null;
    state.status = "crashed";
    logger.warn?.(`bot ${state.botId}: ${message}`);
    await report(state.botId, "crashed", message);
    scheduleRestart(state);
  }

  function handleExit(state, child, info) {
    if (state.child !== child || state.stopping) return;
    state.child = null;
    state.status = "crashed";
    const reason = info.error
      ? `spawn error: ${info.error.message}`
      : info.signal
        ? `killed by signal ${info.signal}`
        : `exited with code ${info.code}`;
    void report(state.botId, "crashed", reason);
    scheduleRestart(state);
  }

  /** Lowest uid slot no tracked bot holds; slots free up when a bot is removed. */
  function allocateUidSlot() {
    const used = new Set([...bots.values()].map((state) => state.uidSlot));
    for (let slot = 0; slot < UID_SLOT_COUNT; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  function launch(state, bot, dir, credential) {
    state.startedAt = now();
    const child = spawnImpl({
      config,
      bot,
      dir,
      credential,
      usePrlimit: state.usePrlimit,
      onLine: (stream, line) => shipper?.add(state.botId, stream, line),
      onExit: (exitedChild, info) => handleExit(state, exitedChild, info),
    });
    state.child = child;
    state.status = "running";
    void report(state.botId, "running");
  }

  async function fetchLaunchInputs(state) {
    let bundle;
    try {
      bundle = await api.bundle(state.botId);
    } catch (error) {
      await failLaunch(state, `bundle fetch failed: ${error.message}`);
      return null;
    }
    if (bundle === null) {
      state.status = "stopped";
      return null;
    }

    let credential;
    try {
      credential = (await api.credential(state.botId))?.token;
    } catch (error) {
      await failLaunch(state, `credential fetch failed: ${error.message}`);
      return null;
    }
    if (typeof credential !== "string" || credential.length < 1) {
      await failLaunch(state, "runner API returned no credential");
      return null;
    }
    return { bundle, credential };
  }

  async function writeBotDir(state, bundle) {
    const dir = botDir(state.botId);
    try {
      resetBotDir(dir);
      writeBundleFiles(dir, bundle.files);
    } catch (error) {
      await failLaunch(state, `bundle write failed: ${error.message}`);
      return null;
    }
    return dir;
  }

  async function startBot(state) {
    state.child = null;
    state.status = "starting";
    await report(state.botId, "starting");

    const inputs = await fetchLaunchInputs(state);
    if (inputs === null) return;
    const { bundle, credential } = inputs;

    const dir = await writeBotDir(state, bundle);
    if (dir === null) return;

    // Hand the directory to the bot before anything of the bot's runs, so the
    // dependency install executes as the bot's uid and never as the supervisor.
    const uidGid = botUidGid(config, state.uidSlot);
    if (uidGid) chownTree(dir, uidGid.uid, uidGid.gid);

    const deps = await install({ config, dir, uidGid });
    if (!deps.ok) {
      await failLaunch(state, deps.message);
      return;
    }

    const bot = {
      botId: state.botId,
      userId: bundle.userId ?? state.meta.userId,
      name: bundle.name ?? state.meta.name,
      language: bundle.language ?? state.meta.language,
      entry: bundle.entry ?? state.meta.entry,
      env: bundle.env ?? {},
      uidSlot: state.uidSlot,
    };
    if (bot.language !== "python") linkTsSdk(config, dir, uidGid);
    launch(state, bot, dir, credential);
  }

  async function ensureBot(desired) {
    const state = bots.get(desired.botId);
    if (state === undefined) {
      if (runningCount() >= config.maxBots) {
        logger.warn?.(`bot ${desired.botId}: skipping, at BOT_RUNNER_MAX_BOTS (${config.maxBots})`);
        return;
      }
      const uidSlot = allocateUidSlot();
      if (uidSlot === null) {
        logger.warn?.(`bot ${desired.botId}: skipping, no free uid slot`);
        return;
      }
      const created = createState(desired, prlimit, uidSlot);
      bots.set(desired.botId, created);
      await startBot(created);
      return;
    }
    state.meta = desired;
    const changed =
      state.revision !== desired.revision || state.restartNonce !== desired.restartNonce;
    if (!changed) return;
    state.revision = desired.revision;
    state.restartNonce = desired.restartNonce;
    await stopBot(state);
    await startBot(state);
  }

  async function processPendingRestarts() {
    for (const state of bots.values()) {
      if (state.child || state.nextStartAt === null) continue;
      if (now() < state.nextStartAt) continue;
      if (runningCount() >= config.maxBots) continue;
      state.nextStartAt = null;
      await startBot(state);
    }
  }

  async function reconcile(desiredList) {
    const desired = new Map();
    for (const bot of desiredList ?? []) {
      if (isSafeBotId(bot?.botId)) desired.set(bot.botId, bot);
      else logger.warn?.(`bot runner: ignoring desired bot with unsafe id: ${String(bot?.botId)}`);
    }
    for (const [botId, state] of [...bots.entries()]) {
      if (!desired.has(botId)) await stopBot(state, { remove: true });
    }
    for (const bot of desired.values()) await ensureBot(bot);
    await processPendingRestarts();
  }

  /** Stops every bot in parallel: SIGTERM to all, one grace period, then SIGKILL. */
  async function shutdown() {
    const states = [...bots.values()];
    for (const state of states) {
      state.stopping = true;
      if (state.child) signalBotGroup(state.child, "SIGTERM");
    }
    await Promise.all(states.map((state) => waitForExit(state.child, config.shutdownGraceMs)));
    for (const state of states) {
      if (state.child && state.child.exitCode === null && state.child.signalCode === null) {
        signalBotGroup(state.child, "SIGKILL");
      }
      state.child = null;
      state.status = "stopped";
      removeBotDir(botDir(state.botId));
    }
    await Promise.all(states.map((state) => report(state.botId, "stopped")));
    bots.clear();
  }

  function snapshot() {
    return [...bots.values()].map((state) => ({
      botId: state.botId,
      status: state.status,
      pid: state.child?.pid ?? null,
      revision: state.revision,
      restartNonce: state.restartNonce,
      crashCount: state.crashCount,
    }));
  }

  return { reconcile, shutdown, snapshot };
}
