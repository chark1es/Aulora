// Optional dependency installation for a bot, before its first launch.
//
//   requirements.txt -> pip install --target <dir>/.deps -r requirements.txt
//   package.json     -> npm install --omit=dev --ignore-scripts --no-audit --no-fund
//
// Both run with a hard timeout (120 s by default). The install environment is
// fresh too: it carries only PATH/HOME/LANG, never the runner token. Failures
// are reported as a short reason, never with raw tool output that could embed
// environment values.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 64 * 1024;

/** Runs one command with a hard timeout. Returns `{ ok, code, timedOut }`. */
export function runWithTimeout({ command, args, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: -1, timedOut: true, output });
    }, timeoutMs);
    const append = (chunk) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) =>
      finish({ ok: false, code: -1, timedOut: false, output: error.message }),
    );
    child.on("close", (code) =>
      finish({ ok: code === 0, code: code ?? -1, timedOut: false, output }),
    );
  });
}

/** Which dependency manifests exist in the bot directory. */
export function dependencyPlan(dir) {
  const plan = [];
  if (existsSync(join(dir, "requirements.txt")))
    plan.push({ tool: "pip", file: "requirements.txt" });
  if (existsSync(join(dir, "package.json"))) plan.push({ tool: "npm", file: "package.json" });
  return plan;
}

function installEnv(config, dir) {
  return {
    PATH: config.childPath,
    HOME: dir,
    LANG: config.lang,
    npm_config_cache: join(config.workDir, ".npm-cache"),
    npm_config_update_notifier: "false",
  };
}

async function runStep(step, config, dir) {
  if (step.tool === "pip") {
    return runWithTimeout({
      command: config.pipBin,
      args: [
        "install",
        "--target",
        join(dir, ".deps"),
        "-r",
        join(dir, "requirements.txt"),
        "--no-cache-dir",
      ],
      cwd: dir,
      env: installEnv(config, dir),
      timeoutMs: config.dependencyTimeoutMs,
    });
  }
  return runWithTimeout({
    command: config.npmBin,
    args: ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    cwd: dir,
    env: installEnv(config, dir),
    timeoutMs: config.dependencyTimeoutMs,
  });
}

/** Installs every dependency manifest present. Returns `{ ok, message? }`. */
export async function installDependencies({ config, dir }) {
  for (const step of dependencyPlan(dir)) {
    const result = await runStep(step, config, dir);
    if (!result.ok) {
      const reason = result.timedOut
        ? `timed out after ${Math.round(config.dependencyTimeoutMs / 1000)}s`
        : `exited with code ${result.code}`;
      return { ok: false, message: `${step.tool} install (${step.file}) ${reason}` };
    }
  }
  return { ok: true };
}
