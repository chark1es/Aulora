import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReleaseManifest,
  platformFromFile,
} from "../../apps/desktop/scripts/release-manifest.mjs";

export async function assembleRelease(directory, version, repository, notes = "") {
  const files = readdirSync(directory);
  const patterns = {
    "darwin-aarch64": /_darwin-aarch64\.app\.tar\.gz$/,
    "darwin-x86_64": /_darwin-x86_64\.app\.tar\.gz$/,
    "windows-x86_64": /_x64-setup\.exe$/,
    "linux-x86_64": /\.AppImage$/,
  };
  const baseUrl = `https://github.com/${repository}/releases/download/v${version}`;
  const platforms = [];
  for (const [target, pattern] of Object.entries(patterns)) {
    const matches = files.filter((file) => pattern.test(file));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${target} updater artifact.`);
    platforms.push(await platformFromFile(target, join(directory, matches[0]), baseUrl));
  }
  for (const suffix of [
    "_android.apk",
    "_android.aab",
    "_ios.ipa",
    "_web.zip",
    "_docs.zip",
    "_legal.zip",
  ]) {
    if (!files.includes(`Aulora_${version}${suffix}`))
      throw new Error(`Missing release file: ${suffix}`);
  }
  for (const file of [
    "LICENSE",
    "NOTICE",
    "COMMERCIAL.md",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_JAVASCRIPT.txt",
  ]) {
    if (!files.includes(file)) throw new Error(`Missing release notice: ${file}`);
  }
  const manifest = buildReleaseManifest({
    version,
    notes,
    pubDate: new Date().toISOString(),
    platforms,
  });
  writeFileSync(join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function writeChecksums(directory) {
  const hashes = readdirSync(directory)
    .filter((file) => file !== "SHA256SUMS")
    .sort()
    .map((file) => {
      const digest = createHash("sha256")
        .update(readFileSync(join(directory, file)))
        .digest("hex");
      return `${digest}  ${file}`;
    });
  writeFileSync(join(directory, "SHA256SUMS"), `${hashes.join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = "dist/release";
  if (process.argv[2] === "checksums") writeChecksums(directory);
  else
    await assembleRelease(
      directory,
      process.env.RELEASE_VERSION,
      process.env.GITHUB_REPOSITORY,
      process.env.RELEASE_NOTES,
    );
}
