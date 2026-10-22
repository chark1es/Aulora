import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, normalizeBaseUrl, pollDelayMs } from "../src/config.mjs";
import { nextBackoff } from "../src/reconciler.mjs";

test("pollDelayMs uses the active cadence with bots and the idle cadence when empty", () => {
  const base = { activeMs: 3000, idleMs: 45000, jitter: 0.2 };
  assert.equal(pollDelayMs({ ...base, active: true, random: () => 0.5 }), 3000);
  assert.equal(pollDelayMs({ ...base, active: false, random: () => 0.5 }), 45000);
  // The ±20% spread bounds the delay on both sides.
  assert.equal(pollDelayMs({ ...base, active: true, random: () => 0 }), 2400);
  assert.equal(pollDelayMs({ ...base, active: true, random: () => 1 }), 3600);
  assert.equal(pollDelayMs({ ...base, active: false, random: () => 1 }), 54000);
  assert.equal(pollDelayMs({ ...base, active: false, random: () => 0 }), 36000);
});

test("normalizeBaseUrl canonicalizes and rejects non-http schemes", () => {
  assert.equal(normalizeBaseUrl("http://convex-backend:3211", "x"), "http://convex-backend:3211");
  assert.equal(normalizeBaseUrl("https://example.com/base/", "x"), "https://example.com/base");
  assert.throws(() => normalizeBaseUrl("ftp://example.com", "x"), /unsupported URL scheme/);
  assert.throws(() => normalizeBaseUrl("not a url", "x"), /invalid URL/);
});

test("loadConfig leaves the runner token unset so the entrypoint can idle", () => {
  // The container starts with the stack; a missing token must not crash-loop it.
  assert.equal(loadConfig({}).runnerToken, undefined);
  assert.equal(loadConfig({ BOT_RUNNER_TOKEN: "   " }).runnerToken, undefined);
});

test("loadConfig reads the runner token and applies safe defaults", () => {
  const config = loadConfig({ BOT_RUNNER_TOKEN: "secret", CONVEX_HTTP_URL: "http://x:3211/" });
  assert.equal(config.runnerToken, "secret");
  assert.equal(config.convexHttpUrl, "http://x:3211");
  assert.equal(config.convexSelfHostedUrl, "http://convex-backend:3210");
  assert.equal(config.workDir, "/work");
  assert.equal(config.maxBots, 10);
  assert.equal(config.botMemoryMb, 256);
  assert.equal(config.uidBase, 20000);
  assert.equal(config.pollIntervalMs, 3000);
  assert.equal(config.pollIdleIntervalMs, 20000);
  assert.equal(config.pollJitter, 0.2);
});

test("loadConfig rejects a relative WORK_DIR", () => {
  assert.throws(
    () => loadConfig({ BOT_RUNNER_TOKEN: "secret", WORK_DIR: "relative" }),
    /WORK_DIR must be an absolute path/,
  );
});

test("loadConfig ignores HOST_ENV_FILE: the token only comes from the environment", () => {
  assert.equal(loadConfig({ HOST_ENV_FILE: "/host/.env" }).runnerToken, undefined);
});

test("nextBackoff doubles to the cap and resets after a healthy uptime", () => {
  const options = { baseMs: 1000, maxMs: 60000, resetMs: 60000 };
  assert.deepEqual(nextBackoff({ crashCount: 0, uptimeMs: 0, ...options }), {
    crashCount: 1,
    delayMs: 1000,
  });
  assert.deepEqual(nextBackoff({ crashCount: 1, uptimeMs: 0, ...options }), {
    crashCount: 2,
    delayMs: 2000,
  });
  assert.deepEqual(nextBackoff({ crashCount: 2, uptimeMs: 0, ...options }), {
    crashCount: 3,
    delayMs: 4000,
  });
  assert.equal(nextBackoff({ crashCount: 20, uptimeMs: 0, ...options }).delayMs, 60000);
  assert.deepEqual(nextBackoff({ crashCount: 9, uptimeMs: 90000, ...options }), {
    crashCount: 1,
    delayMs: 1000,
  });
});
