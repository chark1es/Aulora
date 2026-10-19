// Launches a single bot process.
//
// Security properties, in order of importance:
//   - the child never inherits the runner's environment; it gets exactly the
//     documented variables plus its own, so `BOT_RUNNER_TOKEN` cannot leak;
//   - when the supervisor runs as root each bot gets its own uid/gid and the
//     work directory is chowned to it (mode 0700);
//   - resource limits are applied with `prlimit` when available, and a V8 heap
//     cap is added for TypeScript bots;
//   - the process is detached so its whole group can be signalled on shutdown.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createLineBuffer } from "./logs.mjs";

export const UID_SLOT_COUNT = 1000;
const PYTHON_AS_FACTOR = 4;
const PYTHON_MIN_ADDRESS_SPACE_MB = 1024;

/**
 * Per-bot uid/gid for a unique `slot` handed out by the reconciler, so no two
 * running bots ever share an identity (a hash could collide and let one bot
 * read another's directory). Only used when the supervisor is root; otherwise
 * the bot runs as the current user (tests, local dev).
 */
export function botUidGid(config, slot) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return null;
  if (!Number.isInteger(slot) || slot < 0 || slot >= UID_SLOT_COUNT) return null;
  const id = config.uidBase + slot;
  return { uid: id, gid: id };
}

/** The command (and args) that runs a bot's entry file. */
export function botCommand(config, language, entry) {
  if (language === "python") return { command: config.pythonBin, args: ["-u", entry] };
  return { command: config.tsxBin, args: [entry] };
}

/** The fresh environment a bot receives: the documented variables, nothing else. */
export function buildBotEnv({ config, bot, dir, credential }) {
  const env = { ...(bot.env ?? {}) };
  env.AULORA_TOKEN = credential;
  env.AULORA_SITE_URL = config.convexHttpUrl;
  env.AULORA_CONVEX_URL = config.convexSelfHostedUrl;
  env.AULORA_BOT_ID = bot.botId;
  env.AULORA_BOT_USER_ID = bot.userId;
  env.AULORA_BOT_NAME = bot.name;
  env.PATH = config.childPath;
  env.HOME = dir;
  // /tmp is shared by every bot; keep scratch files in the bot's own 0700 dir.
  env.TMPDIR = dir;
  env.LANG = config.lang;
  if (bot.language === "python") {
    env.PYTHONPATH = join(dir, ".deps");
  } else if (config.botMemoryMb > 0) {
    env.NODE_OPTIONS = `--max-old-space-size=${config.botMemoryMb}`;
  }
  return env;
}

/** True when `prlimit` can be used for resource limits. */
export function detectPrlimit(config) {
  const result = spawnSync(config.prlimitBin, ["--version"], { stdio: "ignore" });
  return result.error === undefined && result.status === 0;
}

/**
 * `prlimit` arguments for the configured limits. Process count and file size
 * apply to every bot. An address-space cap (`--as`) is only safe for Python:
 * V8 reserves far more virtual memory than it uses, so Node cannot even start
 * under a small `RLIMIT_AS` on Linux. TypeScript bots are capped by the V8 heap
 * limit in `NODE_OPTIONS` instead, and the container's `mem_limit` backs both.
 * Python gets a generous multiple because threads and libraries reserve virtual
 * address space well beyond what they touch.
 */
export function resourceLimitArgs(config, language) {
  const args = [`--nproc=${config.botNproc}`, `--fsize=${config.botFileSizeBytes}`];
  if (language === "python") {
    const mebibytes = Math.max(PYTHON_MIN_ADDRESS_SPACE_MB, config.botMemoryMb * PYTHON_AS_FACTOR);
    args.push(`--as=${mebibytes * 1024 * 1024}`);
  }
  return args;
}

/**
 * Symlinks the TypeScript SDK into the bot's `node_modules` after any npm
 * install, so `import "@aulora/bot"` resolves to the image's built copy. When
 * the supervisor is root the directory already belongs to the bot, which the
 * supervisor cannot write into, so the link is made as the bot's own uid.
 */
export function linkTsSdk(config, dir, uidGid = null) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- config.botSdkTsDir is the image's fixed /opt/aulora/bot-sdk build output from validated config, not remote input.
  if (!existsSync(config.botSdkTsDir)) return;
  const scope = join(dir, "node_modules", "@aulora");
  const link = join(scope, "bot");
  if (uidGid) {
    const asBot = { uid: uidGid.uid, gid: uidGid.gid, stdio: "ignore" };
    spawnSync("mkdir", ["-p", scope], asBot);
    spawnSync("ln", ["-sfn", config.botSdkTsDir, link], asBot);
    return;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `scope` sits under the bot's own work directory `dir`, which the reconciler builds from a isSafeBotId-validated bot id.
  mkdirSync(scope, { recursive: true, mode: 0o700 });
  rmSync(link, { recursive: true, force: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `link` is always `<bot work dir>/node_modules/@aulora/bot`, derived from that same validated work directory.
  symlinkSync(config.botSdkTsDir, link, "dir");
}

/**
 * Runs `command` inside `dir` for a process that switches uid. libuv changes
 * directory in the child BEFORE it drops to the target uid, i.e. still as root,
 * and root (holding only SETUID/SETGID/CHOWN/KILL) cannot enter a directory owned by
 * the bot at mode 0700. A tiny `sh` therefore does the `cd` after the switch.
 */
export function inDirAfterSwitch(dir, command, args) {
  return {
    command: "/bin/sh",
    args: ["-c", 'cd "$1" && shift && exec "$@"', "sh", dir, command, ...args],
  };
}

function spawnOptions(dir, env, uidGid) {
  const options = { env, detached: true, stdio: ["ignore", "pipe", "pipe"] };
  if (uidGid) {
    options.uid = uidGid.uid;
    options.gid = uidGid.gid;
  } else {
    options.cwd = dir;
  }
  return options;
}

/**
 * Spawns the bot and wires line-buffered stdout/stderr. `onExit(child, info)` is
 * called exactly once, whether the process exits, is signalled, or fails to
 * start.
 */
export function spawnBot({ config, bot, dir, credential, usePrlimit, onLine, onExit }) {
  const { command, args } = botCommand(config, bot.language, bot.entry);
  const env = buildBotEnv({ config, bot, dir, credential });
  const uidGid = botUidGid(config, bot.uidSlot);
  const options = spawnOptions(dir, env, uidGid);
  const argv = usePrlimit
    ? {
        command: config.prlimitBin,
        args: [...resourceLimitArgs(config, bot.language), "--", command, ...args],
      }
    : { command, args };
  const launch = uidGid ? inDirAfterSwitch(dir, argv.command, argv.args) : argv;
  const child = spawn(launch.command, launch.args, options);

  let exited = false;
  const finish = (info) => {
    if (exited) return;
    exited = true;
    stdout.flush();
    stderr.flush();
    onExit(child, info);
  };

  const stdout = createLineBuffer((line) => onLine("stdout", line), config.logLineBytes);
  const stderr = createLineBuffer((line) => onLine("stderr", line), config.logLineBytes);
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", (error) => finish({ code: -1, signal: null, error }));
  child.on("close", (code, signal) => finish({ code: code ?? -1, signal }));
  return child;
}

/** Signals the bot's whole process group, falling back to the process itself. */
export function signalBotGroup(child, signal) {
  if (!child || typeof child.pid !== "number") return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

/** Resolves when the child exits, or after `timeoutMs`. */
export function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    child.once("exit", finish);
    child.once("error", finish);
  });
}
