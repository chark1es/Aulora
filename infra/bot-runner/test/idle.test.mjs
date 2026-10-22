import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIdleKeeper } from "../src/idle.mjs";

function silentLogger() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

test("idle keeper refreshes the health file and logs why bots are off", () => {
  const dir = mkdtempSync(join(tmpdir(), "aulora-bot-idle-"));
  const healthFile = join(dir, "ready");
  const logger = silentLogger();
  try {
    const idle = createIdleKeeper({ healthFile, intervalMs: 60_000, logger, now: () => 42 });
    idle.start();
    assert.equal(readFileSync(healthFile, "utf8"), "42");
    assert.match(logger.lines.join("\n"), /BOT_RUNNER_TOKEN is not set/);
    idle.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle keeper survives an unwritable health file and stops cleanly", () => {
  const logger = silentLogger();
  const idle = createIdleKeeper({
    healthFile: "/definitely/not/writable/ready",
    intervalMs: 60_000,
    logger,
  });
  idle.start();
  idle.touch();
  idle.stop();
  idle.stop();
  assert.equal(logger.lines.length, 1);
});
