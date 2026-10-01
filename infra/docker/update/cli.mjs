// Host-side update check for a self-hosted workspace.
//
//   bun update/cli.mjs check --output ../.update-status.json
//   bun update/cli.mjs mark --file ../.update-status.json --state applying
//
// The decision lives in @aulora/core. This file only reads the checkout, the
// optional deployed-version stamp, and the release feed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  autoUpdateEnabled,
  loadPublishedRelease,
  planWorkspaceUpdate,
  readDeclaredVersion,
  resolveGitHubRepo,
  resolveManifestUrl,
  updateChannel,
} from "../../../packages/core/src/updates.ts";

const dockerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(dockerDir, "../..");
const versionFile = resolve(repoRoot, "packages/convex/convex/lib/env.ts");
const deployedFile = resolve(dockerDir, ".deployed-version");
const envFile = resolve(dockerDir, ".env");

const STATES = new Set(["idle", "applying", "failed", "current"]);

export function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function setting(env, key) {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess.trim() !== "") {
    return fromProcess.trim();
  }
  return env[key];
}

function arg(name) {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

export async function checkWorkspace() {
  const env = readEnvFile(envFile);
  const channel = updateChannel(setting(env, "AULORA_UPDATE_CHANNEL"));
  const autoUpdate = autoUpdateEnabled(setting(env, "AULORA_AUTO_UPDATE"));
  const source = readDeclaredVersion(readFileSync(versionFile, "utf8"));
  if (source === null) {
    throw new Error(`Could not read AULORA_VERSION from ${versionFile}`);
  }
  const deployed = existsSync(deployedFile) ? readFileSync(deployedFile, "utf8").trim() : "";
  const manifest = resolveManifestUrl(setting(env, "AULORA_UPDATE_MANIFEST_URL"));
  const repo = resolveGitHubRepo(setting(env, "AULORA_UPDATE_GITHUB_REPO"));
  if ("error" in manifest || "error" in repo) {
    return document({
      sourceVersion: source,
      deployedVersion: deployed === "" ? null : deployed,
      channel,
      autoUpdate,
      error: "error" in manifest ? manifest.error : repo.error,
    });
  }
  const loaded = await loadPublishedRelease({
    manifestUrl: manifest.url,
    githubRepo: repo.repo,
    channel,
  });
  if (loaded.manifest === undefined && loaded.githubRelease === undefined) {
    return document({
      sourceVersion: source,
      deployedVersion: deployed === "" ? null : deployed,
      channel,
      autoUpdate,
      error: loaded.error ?? "No published release found.",
    });
  }
  const plan = planWorkspaceUpdate({
    sourceVersion: source,
    deployedVersion: deployed === "" ? null : deployed,
    channel,
    ...(loaded.manifest !== undefined ? { manifest: loaded.manifest } : {}),
    ...(loaded.githubRelease !== undefined ? { githubRelease: loaded.githubRelease } : {}),
  });
  const error = plan.error === "No published release found." ? null : plan.error;
  return {
    ...plan,
    error,
    autoUpdate,
    state: error !== null ? "failed" : plan.apply === "none" ? "current" : "idle",
    checkedAt: new Date().toISOString(),
  };
}

function document(input) {
  const missing = input.error === "No published release found.";
  return {
    currentVersion: input.deployedVersion ?? input.sourceVersion,
    sourceVersion: input.sourceVersion,
    deployedVersion: input.deployedVersion,
    latestVersion: null,
    updateAvailable: false,
    apply: "none",
    notes: null,
    pubDate: null,
    gitTag: null,
    channel: input.channel,
    error: missing ? null : input.error,
    autoUpdate: input.autoUpdate,
    state: missing ? "current" : "failed",
    checkedAt: new Date().toISOString(),
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const command = process.argv[2];
  if (command === "check") {
    const status = await checkWorkspace();
    const output = arg("--output");
    const json = `${JSON.stringify(status, null, 2)}\n`;
    if (output !== undefined) {
      writeFileSync(resolve(output), json);
    }
    process.stdout.write(json);
    return;
  }
  if (command === "mark") {
    const file = arg("--file");
    const state = arg("--state");
    const error = arg("--error");
    if (file === undefined || state === undefined || !STATES.has(state)) {
      throw new Error("mark needs --file and --state idle|applying|failed|current");
    }
    const status = JSON.parse(readFileSync(file, "utf8"));
    status.state = state;
    status.error = error ?? status.error ?? null;
    if (state !== "failed") {
      status.error = error ?? null;
    }
    status.checkedAt = new Date().toISOString();
    writeJson(file, status);
    return;
  }
  throw new Error(
    "usage: cli.mjs check [--output FILE] | mark --file FILE --state STATE [--error TEXT]",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
