import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateVersion } from "../apps/desktop/scripts/release-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length !== 1) throw new Error("Usage: bun run release:version -- 1.0.0");
const version = validateVersion(args[0]);
const writes = new Map();
const read = (path) => readFileSync(resolve(root, path), "utf8");
function json(path, edit) {
  const value = JSON.parse(read(path));
  edit(value);
  writes.set(path, `${JSON.stringify(value, null, 2)}\n`);
}
function replace(path, pattern, replacement) {
  const source = read(path);
  if (!pattern.test(source)) throw new Error(`Missing version field in ${path}`);
  writes.set(path, source.replace(pattern, replacement));
}
json("package.json", (value) => {
  value.version = version;
});
for (const parent of ["apps", "packages"]) {
  for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    json(`${parent}/${entry.name}/package.json`, (value) => {
      value.version = version;
    });
  }
}
json("infra/push-relay/package.json", (value) => {
  value.version = version;
});
json("apps/desktop/src-tauri/tauri.conf.json", (value) => {
  value.version = version;
});
json("apps/mobile/app.json", (value) => {
  value.expo.version = version;
});
replace(
  "packages/convex/convex/lib/env.ts",
  /export const AULORA_VERSION = "[^"]+";/,
  `export const AULORA_VERSION = "${version}";`,
);
replace("apps/desktop/src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
replace(
  "apps/desktop/src-tauri/Cargo.lock",
  /(name = "aulora-desktop"\nversion = ")[^"]+"/,
  `$1${version}"`,
);
replace(
  "apps/mobile/ios/Aulora/Info.plist",
  /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+/,
  `$1${version}`,
);
replace(
  "apps/mobile/ios/Aulora.xcodeproj/project.pbxproj",
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${version};`,
);
replace(
  "apps/mobile/android/app/build.gradle",
  /(versionName \(System.getenv\('RELEASE_VERSION'\) \?: ")[^"]+/,
  `$1${version}`,
);
replace("apps/web/.env.example", /^AULORA_VERSION=.+$/m, `AULORA_VERSION=${version}`);
replace(
  "apps/web/scripts/write-well-known.ts",
  /(read\(env, "AULORA_VERSION"\) \?\? ")[^"]+/,
  `$1${version}`,
);
replace(
  "infra/docker/setup/well-known.mjs",
  /(version: read\(config.version\) \?\? ")[^"]+/,
  `$1${version}`,
);
// Bun's text lock is JSON with trailing commas. Only change workspace metadata,
// before the dependency/package resolution section.
const lock = read("bun.lock");
const packageStart = lock.indexOf('  "packages":');
if (packageStart < 0) throw new Error("Unexpected Bun lockfile format");
writes.set(
  "bun.lock",
  lock.slice(0, packageStart).replace(/"version": "[^"]+"/g, `"version": "${version}"`) +
    lock.slice(packageStart),
);
for (const [path, content] of writes) writeFileSync(resolve(root, path), content);
console.log(`Prepared version ${version} in ${writes.size} files. No release was published.`);
console.log("Merging a higher Tauri version to main triggers the release workflow.");
