// Bot runner configuration, read from the environment.
//
// Every value has a safe default; a missing runner token means "bots are off"
// and the entrypoint idles rather than crash-looping. Base URLs are parsed and
// normalized here so `api.mjs` is the only module that builds request URLs (and
// does so from validated config, never from a caller-supplied string).
//
// `BOT_RUNNER_TOKEN` must never reach a bot process; only `config.mjs` and the
// API client ever hold it.

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(nonEmpty(value) ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number.parseFloat(nonEmpty(value) ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Poll delay for the supervisor. With bots to supervise, poll on the active
 * cadence; with nothing tracked (the desired set is empty), fall back to the
 * idle cadence so an empty deployment is not a 3 s request stream. A jitter
 * fraction spreads deployments so their polls do not align. `random` is
 * injectable so tests are deterministic.
 */
export function pollDelayMs({ active, activeMs, idleMs, jitter = 0.2, random = Math.random }) {
  const base = active ? activeMs : idleMs;
  const spread = base * jitter;
  return Math.max(1, Math.round(base - spread + random() * spread * 2));
}

/** Parses and canonicalizes a base URL, rejecting anything but http(s). */
export function normalizeBaseUrl(value, fallback) {
  const raw = (nonEmpty(value) ?? fallback).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported URL scheme: ${url.protocol}`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function loadConfig(env = process.env) {
  // Environment only: bots share this container, so the token must never come
  // from a file mount a bot uid could also read. `undefined` means bots are off
  // (first boot, or before `setup` generated the token): `main.mjs` idles.
  const runnerToken = nonEmpty(env.BOT_RUNNER_TOKEN?.trim());
  const workDir = nonEmpty(env.WORK_DIR) ?? "/work";
  if (!workDir.startsWith("/")) {
    throw new Error("WORK_DIR must be an absolute path");
  }
  return {
    runnerToken,
    convexHttpUrl: normalizeBaseUrl(env.CONVEX_HTTP_URL, "http://convex-backend:3211"),
    convexSelfHostedUrl: normalizeBaseUrl(env.CONVEX_SELF_HOSTED_URL, "http://convex-backend:3210"),
    workDir,
    maxBots: positiveInt(env.BOT_RUNNER_MAX_BOTS, 10),
    botMemoryMb: positiveInt(env.BOT_RUNNER_BOT_MEMORY_MB, 256),
    botNproc: positiveInt(env.BOT_RUNNER_BOT_NPROC, 256),
    botFileSizeBytes: positiveInt(env.BOT_RUNNER_BOT_FSIZE_BYTES, 64 * 1024 * 1024),
    uidBase: positiveInt(env.BOT_RUNNER_UID_BASE, 20000),
    pollIntervalMs: positiveInt(env.BOT_RUNNER_POLL_INTERVAL_MS, 3000),
    // Cadence while no bot is tracked (idle deployment). Kept under the
    // server's 30 s runner-online window (with jitter) so an idle runner never
    // shows as offline; still 6x cheaper than the active cadence.
    pollIdleIntervalMs: positiveInt(env.BOT_RUNNER_POLL_IDLE_MS, 20000),
    pollJitter: nonNegativeNumber(env.BOT_RUNNER_POLL_JITTER, 0.2),
    logFlushIntervalMs: positiveInt(env.BOT_RUNNER_LOG_FLUSH_MS, 1000),
    logBatchLines: positiveInt(env.BOT_RUNNER_LOG_BATCH_LINES, 200),
    logLineBytes: positiveInt(env.BOT_RUNNER_LOG_LINE_BYTES, 4096),
    dependencyTimeoutMs: positiveInt(env.BOT_RUNNER_DEP_TIMEOUT_MS, 120000),
    backoffBaseMs: positiveInt(env.BOT_RUNNER_BACKOFF_BASE_MS, 1000),
    backoffMaxMs: positiveInt(env.BOT_RUNNER_BACKOFF_MAX_MS, 60000),
    uptimeResetMs: positiveInt(env.BOT_RUNNER_UPTIME_RESET_MS, 60000),
    shutdownGraceMs: positiveInt(env.BOT_RUNNER_SHUTDOWN_GRACE_MS, 5000),
    healthFile: nonEmpty(env.BOT_RUNNER_HEALTH_FILE) ?? "/tmp/bot-runner-ready",
    botSdkTsDir: nonEmpty(env.BOT_SDK_TS_DIR) ?? "/opt/aulora/bot-sdk",
    pythonBin: nonEmpty(env.BOT_RUNNER_PYTHON) ?? "/opt/venv/bin/python",
    pipBin: nonEmpty(env.BOT_RUNNER_PIP) ?? "/opt/venv/bin/pip",
    nodeBin: nonEmpty(env.BOT_RUNNER_NODE) ?? process.execPath,
    tsxBin: nonEmpty(env.BOT_RUNNER_TSX) ?? "tsx",
    npmBin: nonEmpty(env.BOT_RUNNER_NPM) ?? "npm",
    childPath: nonEmpty(env.BOT_RUNNER_PATH) ?? "/opt/venv/bin:/usr/local/bin:/usr/bin:/bin",
    prlimitBin: nonEmpty(env.BOT_RUNNER_PRLIMIT) ?? "prlimit",
    lang: nonEmpty(env.BOT_RUNNER_LANG) ?? "C.UTF-8",
  };
}
