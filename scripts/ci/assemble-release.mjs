import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReleaseManifest,
  platformFromFile,
} from "../../apps/desktop/scripts/release-manifest.mjs";

const RELEASE_DIRECTORY = "dist/release";

export async function assembleRelease(version, repository, notes = "") {
  const files = readdirSync(RELEASE_DIRECTORY);
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
    platforms.push(await platformFromFile(target, join(RELEASE_DIRECTORY, matches[0]), baseUrl));
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
  // Every signed/distributable file, for the docs download buttons to read from
  // a static manifest instead of the rate-limited GitHub API. Manifests, the
  // checksum file, notes and detached signatures are not downloads.
  const NOT_ASSETS = new Set(["latest.json", "SHA256SUMS", "RELEASE_NOTES.md"]);
  const assets = files
    .filter((file) => !NOT_ASSETS.has(file) && !file.endsWith(".sig"))
    .sort()
    .map((file) => ({ name: file, url: `${baseUrl}/${file}` }));
  const manifest = buildReleaseManifest({
    version,
    notes,
    pubDate: new Date().toISOString(),
    platforms,
    ...(assets.length > 0 ? { assets } : {}),
  });
  writeFileSync(join(RELEASE_DIRECTORY, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function writeChecksums() {
  const hashes = readdirSync(RELEASE_DIRECTORY)
    .filter((file) => file !== "SHA256SUMS")
    .sort()
    .map((file) => {
      const digest = createHash("sha256")
        .update(readFileSync(join(RELEASE_DIRECTORY, file)))
        .digest("hex");
      return `${digest}  ${file}`;
    });
  writeFileSync(join(RELEASE_DIRECTORY, "SHA256SUMS"), `${hashes.join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "checksums") writeChecksums();
  else
    await assembleRelease(
      process.env.RELEASE_VERSION,
      process.env.GITHUB_REPOSITORY,
      readFileSync(join(RELEASE_DIRECTORY, "RELEASE_NOTES.md"), "utf8"),
    );
}
