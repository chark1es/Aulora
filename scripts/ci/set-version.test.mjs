import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const files = [
  "scripts/set-version.mjs",
  "apps/desktop/scripts/release-version.mjs",
  "package.json",
  "bun.lock",
  "infra/push-relay/package.json",
  "apps/desktop/package.json",
  "apps/docs/package.json",
  "apps/mobile/package.json",
  "apps/web/package.json",
  "packages/core/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/mobile/app.json",
  "packages/convex/convex/lib/env.ts",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
  "apps/mobile/ios/Aulora/Info.plist",
  "apps/mobile/ios/Aulora.xcodeproj/project.pbxproj",
  "apps/mobile/android/app/build.gradle",
  "apps/web/.env.example",
  "apps/web/scripts/write-well-known.ts",
  "infra/docker/setup/well-known.mjs",
];
test("version preparation rejects prereleases without edits and synchronizes every distribution", () => {
  const directory = mkdtempSync(join(tmpdir(), "aulora-version-"));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      cpSync(join(root, file), join(directory, file));
    }
    cpSync(
      join(root, "packages/convex/package.json"),
      join(directory, "packages/convex/package.json"),
    );
    const before = readFileSync(join(directory, "bun.lock"), "utf8");
    const script = join(directory, "scripts/set-version.mjs");
    const invalid = spawnSync(process.execPath, [script, "1.0.0-beta.1"], { encoding: "utf8" });
    expect(invalid.status).not.toBe(0);
    expect(readFileSync(join(directory, "bun.lock"), "utf8")).toBe(before);
    const result = spawnSync(process.execPath, [script, "--", "1.2.3"], {
      encoding: "utf8",
      cwd: tmpdir(),
    });
    expect(result.status, result.stderr).toBe(0);
    const read = (file) => readFileSync(join(directory, file), "utf8");
    expect(JSON.parse(read("apps/mobile/app.json")).expo.version).toBe("1.2.3");
    expect(JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).version).toBe("1.2.3");
    expect(read("packages/convex/convex/lib/env.ts")).toContain(
      'export const AULORA_VERSION = "1.2.3";',
    );
    expect(read("apps/desktop/src-tauri/Cargo.lock")).toContain(
      'name = "aulora-desktop"\nversion = "1.2.3"',
    );
    expect(read("apps/mobile/ios/Aulora/Info.plist")).toMatch(
      /CFBundleShortVersionString<\/key>\s*<string>1\.2\.3/,
    );
    expect(read("apps/mobile/android/app/build.gradle")).toContain(
      "versionName (System.getenv('RELEASE_VERSION') ?: \"1.2.3\")",
    );
    expect(read("apps/web/.env.example")).toContain("AULORA_VERSION=1.2.3");
    const split = (lock) => lock.slice(lock.indexOf('  "packages":'));
    expect(split(read("bun.lock"))).toBe(split(before));
    for (const file of ["package.json", "apps/web/package.json", "packages/core/package.json"]) {
      expect(JSON.parse(read(file)).version).toBe("1.2.3");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
