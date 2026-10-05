// Prepare images in a separate checkout. Running containers change only on restart.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isReleaseTag, readDeclaredVersion } from "../../../packages/core/src/updates.ts";
import { checkWorkspace } from "./cli.mjs";

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
        : reject(new Error(`${command} failed (${code}). Check the host updater logs.`)),
    );
  });
}
const defaultDockerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function createStagedUpdater({
  dockerDir = defaultDockerDir,
  repoRoot = resolve(dockerDir, "../.."),
  execute = run,
  check = checkWorkspace,
} = {}) {
  const stage = resolve(dockerDir, ".update-stage");
  const readyFile = resolve(dockerDir, ".update-ready.json");
  const statusFile = resolve(dockerDir, ".update-status.json");
  const envFile = resolve(dockerDir, ".env");
  const stamp = resolve(dockerDir, ".deployed-version");
  const git = (...args) => execute("git", ["-C", repoRoot, ...args], repoRoot);
  const compose = (cwd, ...args) => execute("docker", ["compose", ...args], cwd);
  const fingerprint = () => createHash("sha256").update(readFileSync(envFile)).digest("hex");
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const write = (path, value) =>
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  async function inspectImages(images) {
    const entries = [];
    for (const service of ["web", "setup", "smtp-gateway"]) {
      const serviceConfig = Object.getOwnPropertyDescriptor(images.services, service)?.value;
      const name = serviceConfig?.image ?? `${images.name}-${service}`;
      const id = await execute(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", name],
        dockerDir,
      );
      entries.push([service, { name, id }]);
    }
    return Object.fromEntries(entries);
  }
  async function assertPreparedImages(prepared) {
    for (const image of Object.values(prepared.imageIds)) {
      const id = await execute(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", image.name],
        dockerDir,
      );
      if (id !== image.id)
        throw new Error(
          "Prepared images have changed. Remove .update-ready.json and download the update again.",
        );
    }
  }
  async function assertClean() {
    if ((await git("status", "--porcelain")) !== "")
      throw new Error(
        "Working tree has uncommitted changes. Commit or stash them before updating.",
      );
  }
  function status(plan, state, error = null) {
    write(statusFile, { ...plan, state, error });
  }
  function ready() {
    if (!existsSync(readyFile)) return null;
    const prepared = read(readyFile);
    // A marker survives watcher restarts. Missing images are caught by compose
    // up --no-build on installation, without silently rebuilding the release.
    return prepared;
  }
  async function download() {
    await assertClean();
    if (!existsSync(envFile))
      throw new Error("Configure infra/docker/.env before preparing an update.");
    const plan = await check();
    if (plan.error) throw new Error(plan.error);
    if (!plan.updateAvailable) throw new Error("This workspace is already up to date.");
    const existing = ready();
    if (existing) {
      if (existing.plan.latestVersion === plan.latestVersion) return existing;
      throw new Error("Install the prepared update before downloading another release.");
    }
    status(plan, "downloading");
    let preparedCheckout = false;
    try {
      const baseCommit = await git("rev-parse", "HEAD");
      let commit = baseCommit;
      if (plan.apply === "fast-forward") {
        if (!isReleaseTag(plan.gitTag)) throw new Error("The published release tag is invalid.");
        await git("fetch", "origin", `refs/tags/${plan.gitTag}:refs/tags/${plan.gitTag}`);
        commit = await git("rev-parse", "--verify", `${plan.gitTag}^{commit}`);
        await git("merge-base", "--is-ancestor", baseCommit, commit);
      }
      // Remove an incomplete preparation from a previous attempt.
      if (existsSync(stage)) await git("worktree", "remove", "--force", stage);
      await git("worktree", "add", "--detach", stage, commit);
      preparedCheckout = true;
      const stagedVersion = readDeclaredVersion(
        readFileSync(resolve(stage, "packages/convex/convex/lib/env.ts"), "utf8"),
      );
      const version = plan.apply === "redeploy" ? plan.sourceVersion : plan.latestVersion;
      if (stagedVersion !== version)
        throw new Error("Release source version does not match the published version.");
      const envHash = fingerprint();
      const stageDocker = resolve(stage, "infra/docker");
      writeFileSync(resolve(stageDocker, ".env"), readFileSync(envFile), { mode: 0o600 });
      await compose(stageDocker, "build", "web", "setup", "smtp-gateway");
      const images = JSON.parse(await compose(stageDocker, "config", "--format", "json"));
      // Record immutable image IDs so a later rebuild cannot substitute another release.
      const imageIds = await inspectImages(images);
      const prepared = { plan, baseCommit, commit, envHash, imageIds };
      write(readyFile, prepared);
      status(plan, "ready");
      return prepared;
    } catch (cause) {
      status(plan, "failed", cause instanceof Error ? cause.message : "Download failed.");
      if (preparedCheckout)
        await git("worktree", "remove", "--force", stage).catch(() => undefined);
      throw cause;
    }
  }
  async function restart() {
    const prepared = ready();
    if (!prepared) throw new Error("Download the update before restarting.");
    await assertClean();
    if (fingerprint() !== prepared.envHash)
      throw new Error(
        "Server configuration changed after download. Remove .update-ready.json and download the update again.",
      );
    const head = await git("rev-parse", "HEAD");
    if (head !== prepared.baseCommit && head !== prepared.commit)
      throw new Error("The checkout changed after download. Download the update again.");
    await assertPreparedImages(prepared);
    status(prepared.plan, "applying");
    try {
      if (head !== prepared.commit) await git("merge", "--ff-only", prepared.commit);
      await compose(dockerDir, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "web");
      await compose(dockerDir, "run", "--rm", "setup");
      await compose(
        dockerDir,
        "up",
        "-d",
        "--no-deps",
        "--no-build",
        "--force-recreate",
        "smtp-gateway",
      );
      const version =
        prepared.plan.apply === "redeploy"
          ? prepared.plan.sourceVersion
          : prepared.plan.latestVersion;
      writeFileSync(stamp, `${version}\n`);
      rmSync(readyFile);
      await git("worktree", "remove", "--force", stage).catch(() => undefined);
      const plan = appliedPlan(prepared.plan, version);
      status(plan, "current");
      return plan;
    } catch (cause) {
      // Keep the marker and old stamp so the owner can retry installation.
      status(prepared.plan, "ready", cause instanceof Error ? cause.message : "Restart failed.");
      throw cause;
    }
  }
  return { download, restart, ready };
}

function appliedPlan(preparedPlan, version) {
  return {
    ...preparedPlan,
    currentVersion: version,
    sourceVersion: version,
    deployedVersion: version,
    updateAvailable: false,
    apply: "none",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const updater = createStagedUpdater();
  const operation = process.argv[2];
  if (operation !== "download" && operation !== "restart")
    throw new Error("usage: stage.mjs download|restart");
  const action = operation === "download" ? updater.download : updater.restart;
  action().catch((cause) => {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
}
