// A host watcher with deployment credentials, never a public shell endpoint.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkWorkspace, readEnvFile } from "./cli.mjs";
import { acquireWatcherLock } from "./lock.mjs";
import { createStagedUpdater, run } from "./stage.mjs";

const dockerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(dockerDir, "../..");
const require = createRequire(resolve(repoRoot, "packages/convex/package.json"));
const { ConvexHttpClient } = require("convex/browser");
const env = readEnvFile();
const lock = resolve(dockerDir, ".update-host.lock");
const statusFile = resolve(dockerDir, ".update-status.json");
const updater = createStagedUpdater();
const convexOrigin = `http://127.0.0.1:${env.get("CONVEX_API_PORT") || "3210"}`;
const CONVEX_ORIGINS = [convexOrigin];
const client = new ConvexHttpClient(convexOrigin, {
  fetch: (url, init) => {
    if (CONVEX_ORIGINS.includes(new URL(url).origin)) {
      return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    }
    throw new Error(`Refusing to contact a non-Convex origin: ${url}`);
  },
});
// Secrets are expanded inside the backend container, not shell command arguments.
const key = await run(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "convex-backend",
    "sh",
    "-c",
    'name="$INSTANCE_NAME"; secret="$INSTANCE_SECRET"; [ ! -s /convex/data/credentials/instance_name ] || name="$(cat /convex/data/credentials/instance_name)"; [ ! -s /convex/data/credentials/instance_secret ] || secret="$(cat /convex/data/credentials/instance_secret)"; /convex/generate_key "$name" "$secret"',
  ],
  dockerDir,
);
const adminKey = key.split("\n").find((line) => line.includes("|"));
if (!adminKey) throw new Error("The backend did not generate a deployment key.");
client.setAdminAuth(adminKey);
const releaseLock = acquireWatcherLock(lock);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
let lastCheck = 0;
let current = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) : null;
const interval = Math.max(60, Number(env.get("AULORA_UPDATE_INTERVAL_SECONDS")) || 21600) * 1000;
const call = (name, args = {}) => client.function(`updates:${name}`, undefined, args);
async function report(phase, error = current?.error ?? null) {
  if (!current) return;
  await call("hostReport", {
    status: {
      currentVersion: current.currentVersion,
      latestVersion: current.latestVersion,
      updateAvailable: current.updateAvailable,
      notes: current.notes,
      error,
      autoUpdate: current.autoUpdate,
      phase,
      checkedAt: Date.parse(current.checkedAt) || Date.now(),
    },
  });
}
async function operate(command) {
  if (command === "check") {
    if (updater.ready()) {
      current = updater.ready().plan;
      await report("ready");
      return;
    }
    await report("checking", null);
    const next = await checkWorkspace();
    current =
      next.error && current ? { ...current, error: next.error, checkedAt: next.checkedAt } : next;
    lastCheck = Date.now();
    await report("idle");
    return;
  }
  await report(command === "download" ? "downloading" : "restarting", null);
  // update.sh owns a separate operation lock shared with manual host updates.
  await run(
    "bash",
    [resolve(dockerDir, "update.sh"), command === "download" ? "--download" : "--restart"],
    dockerDir,
  );
  current = JSON.parse(readFileSync(statusFile, "utf8"));
  await report(command === "download" ? "ready" : "idle");
}
const heartbeat = setInterval(() => {
  void call("hostHeartbeat").catch(() => undefined);
}, 5000);
try {
  try {
    const prepared = updater.ready();
    if (prepared) {
      current = prepared.plan;
      await report("ready");
    } else {
      await operate("check");
      if (current?.autoUpdate && current.updateAvailable && !current.error)
        await operate("download");
    }
  } catch (cause) {
    console.error(`[update] ${cause.message}`);
    await report(updater.ready() ? "ready" : "idle", cause.message).catch(() => undefined);
  }
  while (!stopping) {
    try {
      const command = await call("hostPoll");
      if (command) await operate(command);
      else if (!updater.ready() && Date.now() - lastCheck >= interval) {
        await operate("check");
        if (current?.autoUpdate && current.updateAvailable && !current.error)
          await operate("download");
      }
    } catch (cause) {
      console.error(`[update] ${cause.message}`);
      if (existsSync(statusFile)) current = JSON.parse(readFileSync(statusFile, "utf8"));
      await report(updater.ready() ? "ready" : "idle", cause.message).catch(() => undefined);
    }
    await delay(5000);
  }
} finally {
  clearInterval(heartbeat);
  releaseLock();
}
