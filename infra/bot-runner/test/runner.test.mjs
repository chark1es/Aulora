import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunnerApi } from "../src/api.mjs";
import { loadConfig } from "../src/config.mjs";
import { createRunner } from "../src/runner.mjs";
import {
  bundleFor,
  createFakeConvex,
  desiredBot,
  file,
  RUNNER_SECRET,
  waitFor,
} from "./helpers.mjs";

// The runner is driven against a fake Convex server and REAL child processes
// (node, and python3 when present). The bot `tsx` command is `process.execPath`
// so TypeScript bots run as plain Node ESM here; no network is used.

function makeConfig(fake, workDir, overrides = {}) {
  const env = {
    BOT_RUNNER_TOKEN: RUNNER_SECRET,
    CONVEX_HTTP_URL: fake.baseUrl,
    CONVEX_SELF_HOSTED_URL: fake.baseUrl,
    WORK_DIR: workDir,
    BOT_RUNNER_POLL_INTERVAL_MS: "20",
    BOT_RUNNER_LOG_FLUSH_MS: "40",
    BOT_RUNNER_BACKOFF_BASE_MS: "50",
    BOT_RUNNER_BACKOFF_MAX_MS: "200",
    BOT_RUNNER_UPTIME_RESET_MS: "150",
    BOT_RUNNER_SHUTDOWN_GRACE_MS: "400",
    BOT_RUNNER_HEALTH_FILE: join(workDir, "health"),
    BOT_RUNNER_TSX: process.execPath,
    BOT_RUNNER_PATH: process.env.PATH ?? "/usr/bin:/bin",
  };
  return { ...loadConfig(env), ...overrides };
}

function createTestRunner(fake, workDir, overrides = {}) {
  const config = makeConfig(fake, workDir, overrides);
  const warnings = [];
  const runner = createRunner({
    config,
    api: createRunnerApi(config),
    logger: { warn: (m) => warnings.push(m), log() {}, error: (m) => warnings.push(m) },
  });
  return Object.assign(runner, { warnings, config });
}

async function withHarness(testContext, body) {
  const fake = await createFakeConvex();
  const workDir = mkdtempSync(join(tmpdir(), "aulora-bot-runner-"));
  const runners = [];
  testContext.after(async () => {
    for (const runner of runners) {
      try {
        await runner.stop();
      } catch {
        // best effort
      }
    }
    await fake.close();
    rmSync(workDir, { recursive: true, force: true });
  });
  const build = (overrides) => {
    const runner = createTestRunner(fake, workDir, overrides);
    runners.push(runner);
    return runner;
  };
  const start = (overrides) => {
    const runner = build(overrides);
    runner.start();
    return runner;
  };
  await body({ fake, workDir, build, start });
}

function reportCount(fake, botId, status) {
  return fake.state.reports.filter((r) => r.botId === botId && r.status === status).length;
}

function botLines(fake, botId) {
  return fake.state.lines.filter((line) => line.botId === botId);
}

const STAY_ALIVE = "setInterval(() => {}, 1000);";

function markerSource(text) {
  return [`console.log(${JSON.stringify(text)});`, STAY_ALIVE].join("\n");
}

const ENV_DUMP_SOURCE = [
  "const dump = {",
  "  keys: Object.keys(process.env).sort(),",
  "  AULORA_TOKEN: process.env.AULORA_TOKEN,",
  "  AULORA_BOT_ID: process.env.AULORA_BOT_ID,",
  "  AULORA_SITE_URL: process.env.AULORA_SITE_URL,",
  "  FOO: process.env.FOO,",
  "  HOME: process.env.HOME,",
  "  NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,",
  "};",
  'console.log("ENVDUMP " + JSON.stringify(dump));',
  STAY_ALIVE,
].join("\n");

const LONG_LOG_SOURCE = [
  'const long = "x".repeat(5000);',
  'console.log("LONG " + long);',
  "for (let i = 0; i < 250; i += 1) console.log('line ' + i);",
  STAY_ALIVE,
].join("\n");

const CRASH_SOURCE = ['console.log("CRASHING");', "setTimeout(() => process.exit(3), 10);"].join(
  "\n",
);

const SIGTERM_IGNORING_SOURCE = [
  'process.on("SIGTERM", () => {});',
  'console.log("STUBBORN");',
  STAY_ALIVE,
].join("\n");

test("runs an enabled bot with a minimal environment and no runner secrets", async (t) => {
  await withHarness(t, async ({ fake, workDir, start }) => {
    const botId = "bot_alpha";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(
      botId,
      bundleFor(botId, [file("main.mjs", ENV_DUMP_SOURCE)], { FOO: "bar" }),
    );

    start();
    await waitFor(() => reportCount(fake, botId, "running") >= 1, { message: "running report" });
    await waitFor(() => botLines(fake, botId).some((line) => line.text.includes("ENVDUMP")), {
      message: "environment dump",
    });

    const line = botLines(fake, botId).find((l) => l.text.includes("ENVDUMP"));
    const dump = JSON.parse(line.text.slice(line.text.indexOf("{")));
    const expected = new Set([
      "AULORA_TOKEN",
      "AULORA_SITE_URL",
      "AULORA_CONVEX_URL",
      "AULORA_BOT_ID",
      "AULORA_BOT_USER_ID",
      "AULORA_BOT_NAME",
      "FOO",
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "NODE_OPTIONS",
    ]);
    // macOS injects a couple of CoreFoundation variables at process start; every
    // other key must be one the runner deliberately set.
    const osInjected = /^(__CF_|__NEXT_)/;
    for (const key of dump.keys) {
      if (osInjected.test(key)) continue;
      assert.ok(expected.has(key), `bot environment leaked unexpected key: ${key}`);
    }
    for (const key of expected) {
      assert.ok(dump.keys.includes(key), `bot environment is missing ${key}`);
    }
    assert.equal(dump.keys.includes("BOT_RUNNER_TOKEN"), false);
    assert.equal(dump.keys.includes("CONVEX_HTTP_URL"), false);
    assert.equal(dump.keys.includes("WORK_DIR"), false);
    assert.equal(dump.AULORA_TOKEN, fake.state.credentials.get(botId));
    assert.equal(dump.FOO, "bar");
    assert.equal(dump.AULORA_BOT_ID, botId);
    assert.equal(dump.AULORA_SITE_URL, fake.baseUrl);
    assert.equal(dump.HOME, join(workDir, botId));
    assert.ok(dump.NODE_OPTIONS.includes("--max-old-space-size="));

    for (const logged of botLines(fake, botId)) {
      assert.ok(!logged.text.includes(RUNNER_SECRET), "runner token leaked into logs");
    }
  });
});

test("reports starting then running, and mints a hosted credential", async (t) => {
  await withHarness(t, async ({ fake, start }) => {
    const botId = "bot_status";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", markerSource("hello"))]));

    start();
    await waitFor(() => reportCount(fake, botId, "running") >= 1, { message: "running report" });
    const statuses = fake.state.reports.filter((r) => r.botId === botId).map((r) => r.status);
    assert.equal(statuses[0], "starting");
    assert.ok(statuses.includes("running"));
    assert.equal(fake.state.credentials.has(botId), true);
  });
});

test("relaunches a bot when its revision changes", async (t) => {
  await withHarness(t, async ({ fake, build }) => {
    const botId = "bot_revision";
    fake.state.desired = [desiredBot(botId, { revision: 1 })];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", markerSource("REV-ONE"))]));

    const runner = build();
    await runner.tick();
    await waitFor(() => botLines(fake, botId).some((l) => l.text.includes("REV-ONE")), {
      message: "first revision",
    });

    fake.state.desired = [desiredBot(botId, { revision: 2 })];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", markerSource("REV-TWO"))]));
    await runner.tick();
    await waitFor(() => botLines(fake, botId).some((l) => l.text.includes("REV-TWO")), {
      message: "second revision",
    });
    assert.ok((fake.state.credentialCalls.get(botId) ?? 0) >= 2);
  });
});

test("restarts a bot when its restartNonce changes", async (t) => {
  await withHarness(t, async ({ fake, build }) => {
    const botId = "bot_nonce";
    fake.state.desired = [desiredBot(botId, { restartNonce: 0 })];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", markerSource("NONCE"))]));

    const runner = build();
    await runner.tick();
    await waitFor(() => botLines(fake, botId).some((l) => l.text.includes("NONCE")), {
      message: "first launch",
    });

    fake.state.desired = [desiredBot(botId, { restartNonce: 1 })];
    await runner.tick();
    await waitFor(() => (fake.state.credentialCalls.get(botId) ?? 0) >= 2, {
      message: "restart credential",
    });
    const snapshot = runner.snapshot();
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].restartNonce, 1);
  });
});

test("stops and removes a bot that becomes disabled", async (t) => {
  await withHarness(t, async ({ fake, build }) => {
    const botId = "bot_disable";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", markerSource("LIVE"))]));

    const runner = build();
    await runner.tick();
    await waitFor(() => reportCount(fake, botId, "running") >= 1, { message: "running report" });

    fake.state.desired = [];
    await runner.tick();
    await waitFor(() => reportCount(fake, botId, "stopped") >= 1, { message: "stopped report" });
    assert.deepEqual(runner.snapshot(), []);
  });
});

test("relaunches a crashed bot after a backoff", async (t) => {
  await withHarness(t, async ({ fake, start }) => {
    const botId = "bot_crash";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", CRASH_SOURCE)]));

    start();
    await waitFor(() => reportCount(fake, botId, "crashed") >= 1, { message: "crashed report" });
    await waitFor(() => reportCount(fake, botId, "crashed") >= 3, {
      message: "repeated crashes",
      timeout: 4000,
    });
    assert.ok(reportCount(fake, botId, "running") >= 2, "expected relaunches");
  });
});

test("batches and clips bot logs", async (t) => {
  await withHarness(t, async ({ fake, start }) => {
    const botId = "bot_logs";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", LONG_LOG_SOURCE)]));

    start();
    await waitFor(() => botLines(fake, botId).length >= 251, {
      message: "log lines",
      timeout: 6000,
    });

    for (const batch of fake.state.logBatches.filter((b) => b.botId === botId)) {
      assert.ok(batch.lines.length <= 200, `batch exceeded 200 lines: ${batch.lines.length}`);
    }
    for (const line of botLines(fake, botId)) {
      assert.ok(Buffer.byteLength(line.text, "utf8") <= 4096, "log line exceeded 4 KiB");
    }
    const longLine = botLines(fake, botId).find((l) => l.text.startsWith("LONG "));
    assert.ok(longLine, "expected the long line");
    assert.equal(Buffer.byteLength(longLine.text, "utf8"), 4096);
  });
});

test("refuses a bundle file that escapes the bot directory", async (t) => {
  await withHarness(t, async ({ fake, workDir, start }) => {
    const botId = "bot_traversal";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(
      botId,
      bundleFor(botId, [file("../escape.mjs", "boom"), file("safe.mjs", "ok")]),
    );

    start();
    await waitFor(() => reportCount(fake, botId, "crashed") >= 1, { message: "crashed report" });
    const crash = fake.state.reports.find((r) => r.botId === botId && r.status === "crashed");
    assert.match(crash.message, /unsafe bot file path/);
    assert.equal(existsSync(join(workDir, "escape.mjs")), false);
  });
});

test("reports crashed when dependency installation fails", async (t) => {
  await withHarness(t, async ({ fake, workDir, start }) => {
    const npmStub = join(workDir, "npm-stub.sh");
    writeFileSync(npmStub, "#!/bin/sh\nexit 3\n", { mode: 0o755 });
    const botId = "bot_deps";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(
      botId,
      bundleFor(botId, [file("main.mjs", STAY_ALIVE), file("package.json", "{}")]),
    );

    start({ npmBin: npmStub });
    await waitFor(() => reportCount(fake, botId, "crashed") >= 1, { message: "crashed report" });
    const crash = fake.state.reports.find((r) => r.botId === botId && r.status === "crashed");
    assert.match(crash.message, /npm install \(package\.json\)/);
    assert.equal(reportCount(fake, botId, "running"), 0);
  });
});

test("graceful shutdown stops bots and cleans the work directory", async (t) => {
  await withHarness(t, async ({ fake, workDir, start }) => {
    const botId = "bot_shutdown";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", markerSource("SHUTDOWN"))]));

    const runner = start();
    await waitFor(() => reportCount(fake, botId, "running") >= 1, { message: "running report" });
    const [entry] = runner.snapshot();
    assert.ok(entry.pid);

    await runner.stop();
    await waitFor(() => reportCount(fake, botId, "stopped") >= 1, { message: "stopped report" });
    assert.deepEqual(runner.snapshot(), []);
    assert.equal(existsSync(join(workDir, botId)), false);
    await waitFor(() => !isAlive(entry.pid), { message: "process gone" });
  });
});

test("kills a bot that ignores SIGTERM after the grace period", async (t) => {
  await withHarness(t, async ({ fake, start }) => {
    const botId = "bot_stubborn";
    fake.state.desired = [desiredBot(botId)];
    fake.state.bundles.set(botId, bundleFor(botId, [file("main.mjs", SIGTERM_IGNORING_SOURCE)]));

    const runner = start();
    await waitFor(() => reportCount(fake, botId, "running") >= 1, { message: "running report" });
    const [entry] = runner.snapshot();
    assert.ok(entry.pid);

    await runner.stop();
    await waitFor(() => !isAlive(entry.pid), { message: "process killed" });
  });
});

const PYTHON_AVAILABLE = spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;

test("runs a Python bot with PYTHONPATH and no secrets", { skip: !PYTHON_AVAILABLE }, async (t) => {
  await withHarness(t, async ({ fake, start }) => {
    const botId = "bot_python";
    const source = [
      "import json, os, time",
      'print("PYDUMP " + json.dumps({',
      '  "PYTHONPATH": os.environ.get("PYTHONPATH"),',
      '  "AULORA_BOT_ID": os.environ.get("AULORA_BOT_ID"),',
      '  "HOME": os.environ.get("HOME"),',
      '  "runnerTokenAbsent": os.environ.get("BOT_RUNNER_TOKEN") is None,',
      "}))",
      "time.sleep(30)",
    ].join("\n");
    fake.state.desired = [desiredBot(botId, { language: "python", entry: "main.py" })];
    fake.state.bundles.set(
      botId,
      bundleFor(botId, [file("main.py", source)], {}, { language: "python", entry: "main.py" }),
    );

    start({ pythonBin: "python3" });
    await waitFor(() => botLines(fake, botId).some((l) => l.text.includes("PYDUMP")), {
      message: "python dump",
    });
    const line = botLines(fake, botId).find((l) => l.text.includes("PYDUMP"));
    const dump = JSON.parse(line.text.slice(line.text.indexOf("{")));
    assert.equal(dump.runnerTokenAbsent, true);
    assert.equal(dump.AULORA_BOT_ID, botId);
    assert.ok(dump.PYTHONPATH.endsWith(".deps"));
  });
});

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
