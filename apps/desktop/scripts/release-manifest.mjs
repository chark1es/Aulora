// Builds the static updater feed consumed by the desktop shell and the
// workspace updater. Tauri reads `version` and `platforms`; the workspace
// updater reads `workspace`. Every platform entry must be a real signed
// artifact. This script does not invent signatures.
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const TARGET = /^(darwin|windows|linux)-(x86_64|aarch64|i686|armv7)$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateVersion(version) {
  if (!VERSION.test(version)) {
    throw new Error("Use a stable version such as 1.0.0, without a v prefix or prerelease suffix.");
  }
  return version;
}

export function buildReleaseManifest({ version, notes, pubDate, platforms }) {
  validateVersion(version);
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error("At least one signed platform artifact is required.");
  }
  const entries = {};
  for (const platform of platforms) {
    if (!TARGET.test(platform.target)) {
      throw new Error(`Unsupported updater target: ${platform.target}`);
    }
    if (entries[platform.target] !== undefined) {
      throw new Error(`Duplicate updater target: ${platform.target}`);
    }
    if (typeof platform.url !== "string" || !platform.url.startsWith("https://")) {
      throw new Error(`Platform ${platform.target} needs an https artifact URL.`);
    }
    const signature = typeof platform.signature === "string" ? platform.signature.trim() : "";
    if (signature === "" || signature.includes("PLACEHOLDER")) {
      throw new Error(`Platform ${platform.target} needs the contents of its .sig file.`);
    }
    entries[platform.target] = { signature, url: platform.url };
  }
  return {
    version,
    notes: notes ?? "",
    pub_date: pubDate,
    platforms: entries,
    workspace: {
      version,
      gitTag: `v${version}`,
    },
  };
}

export async function platformFromFile(target, file, baseUrl) {
  const signature = (await readFile(`${file}.sig`, "utf8")).trim();
  const url = `${baseUrl.replace(/\/$/, "")}/${basename(file)}`;
  return { target, url, signature };
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      notes: { type: "string" },
      "base-url": { type: "string" },
      platform: { type: "string", multiple: true },
      output: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: bun run release-manifest --version 1.0.0 --base-url https://github.com/chark1es/Aulora/releases/download/v1.0.0 --platform darwin-aarch64=Aulora.app.tar.gz",
    );
    return;
  }
  const version = validateVersion(values.version ?? "");
  const baseUrl = values["base-url"];
  if (baseUrl === undefined || !baseUrl.startsWith("https://")) {
    throw new Error("--base-url must be the https download directory for this release.");
  }
  const specs = values.platform ?? [];
  if (specs.length === 0) {
    throw new Error("Pass one --platform target=path for each signed artifact.");
  }
  const platforms = [];
  for (const spec of specs) {
    const split = spec.indexOf("=");
    if (split === -1) {
      throw new Error(`Expected target=path, got ${spec}`);
    }
    platforms.push(
      await platformFromFile(spec.slice(0, split), resolve(spec.slice(split + 1)), baseUrl),
    );
  }
  const manifest = buildReleaseManifest({
    version,
    notes: values.notes ?? "",
    pubDate: new Date().toISOString(),
    platforms,
  });
  const output = resolve(values.output ?? "latest.json");
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
