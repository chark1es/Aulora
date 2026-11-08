// Pin and restore the previous web image for a deployment.
//
// `deploy.sh` runs `pin` before rebuilding, which tags the currently running
// web image as `aulora-web:previous` and records its identity and deployed
// version. `rollback` verifies that tag still points at the recorded image,
// retags it as the live `aulora-web:local`, and recreates only the web service.
// Backend functions are not rolled back: they must stay compatible with the
// previous web build for this path to be safe.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_IMAGE = "aulora-web:local";
export const PREVIOUS_WEB_IMAGE = "aulora-web:previous";
export const FAILED_WEB_IMAGE = "aulora-web:failed";
export const STATE_FILE = ".deployed-web-image.json";

const defaultDockerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function run(command, args, cwd) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolveResult(output.trim())
        : reject(new Error(`${command} failed (${code}). Check the deployment logs.`)),
    );
  });
}

function imageId(execute, dockerDir, name) {
  return execute("docker", ["image", "inspect", "--format", "{{.Id}}", name], dockerDir);
}

function readVersionStamp(dockerDir) {
  const path = resolve(dockerDir, ".deployed-version");
  return existsSync(path) ? readFileSync(path, "utf8").trim() || null : null;
}

function readState(dockerDir) {
  const path = resolve(dockerDir, STATE_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function writeState(dockerDir, state) {
  writeFileSync(resolve(dockerDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function pinCurrentWebImage({
  dockerDir = defaultDockerDir,
  execute = run,
  now = () => new Date(),
} = {}) {
  let current = null;
  try {
    // Prefer the image the running container actually uses: a failed earlier
    // deploy can leave the local tag pointing at a build that never served.
    const container = await execute("docker", ["compose", "ps", "-q", "web"], dockerDir);
    if (container !== "") {
      current = await execute(
        "docker",
        ["inspect", "--format", "{{.Image}}", container],
        dockerDir,
      );
    }
  } catch {
    // Fall back to the local tag below.
  }
  if (current === null || current === "") {
    try {
      current = await imageId(execute, dockerDir, WEB_IMAGE);
    } catch {
      // A first install has no web image yet; there is nothing to roll back to.
      return null;
    }
  }
  await execute("docker", ["tag", current, PREVIOUS_WEB_IMAGE], dockerDir);
  const state = {
    imageId: current,
    version: readVersionStamp(dockerDir),
    pinnedAt: now().toISOString(),
  };
  writeState(dockerDir, state);
  return state;
}

export async function rollbackWeb({
  dockerDir = defaultDockerDir,
  execute = run,
  log = () => {},
} = {}) {
  const state = readState(dockerDir);
  if (state === null) {
    throw new Error(
      "No pinned web image found. Run ./deploy.sh first; rollback restores the image recorded by that deployment.",
    );
  }
  const pinned = await imageId(execute, dockerDir, PREVIOUS_WEB_IMAGE);
  if (pinned !== state.imageId) {
    throw new Error(
      "The pinned previous web image changed. Refusing to roll back to an unidentified build.",
    );
  }
  let current = null;
  try {
    current = await imageId(execute, dockerDir, WEB_IMAGE);
  } catch {
    // Missing local tag: rollback can still restore the pinned image.
  }
  if (current === state.imageId) {
    throw new Error("The previous web image is already the running web image.");
  }
  if (current !== null) {
    // Keep the failed build available for inspection instead of deleting it.
    await execute("docker", ["tag", WEB_IMAGE, FAILED_WEB_IMAGE], dockerDir);
  }
  await execute("docker", ["tag", PREVIOUS_WEB_IMAGE, WEB_IMAGE], dockerDir);
  await execute(
    "docker",
    ["compose", "up", "-d", "--no-deps", "--no-build", "--force-recreate", "web"],
    dockerDir,
  );
  if (state.version !== null) {
    writeFileSync(resolve(dockerDir, ".deployed-version"), `${state.version}\n`);
  }
  log(
    `Rolled back the web container to ${state.version ?? state.imageId}. Backend functions were not rolled back.`,
  );
  return state;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2];
  if (operation !== "pin" && operation !== "rollback") {
    throw new Error("usage: rollback.mjs pin|rollback");
  }
  const action = operation === "pin" ? pinCurrentWebImage : rollbackWeb;
  action({ log: (message) => process.stdout.write(`${message}\n`) }).catch((cause) => {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
}
