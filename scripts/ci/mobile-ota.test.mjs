import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ota from "./mobile-ota.cjs";

test("Expo configuration enables background updates only for a valid project", () => {
  const config = ota.updateConfig("00000000-0000-0000-0000-000000000001", "mobile-test");
  expect(config.updates.url).toBe("https://u.expo.dev/00000000-0000-0000-0000-000000000001");
  expect(config.updates.requestHeaders).toEqual({ "expo-channel-name": "production" });
  expect(config.updates.fallbackToCacheTimeout).toBe(0);
  for (const id of [undefined, "", "https://evil.example", "not-a-uuid"]) {
    expect(() => ota.updateConfig(id, "runtime")).toThrow("EAS_PROJECT_ID");
  }
});

test("incompatible native runtimes require a full release", () => {
  expect(() => ota.assertCompatible("same", "same")).not.toThrow();
  expect(() => ota.assertCompatible("old", "new")).toThrow("full mobile release");
});

test("runtime hashes ignore JS changes but detect native and lockfile changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "aulora-ota-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  try {
    mkdirSync(join(dir, "scripts/ci"), { recursive: true });
    mkdirSync(join(dir, "apps/mobile/android"), { recursive: true });
    // Use the real helper in an isolated synthetic repository.
    writeFileSync(
      join(dir, "scripts/ci/mobile-ota.cjs"),
      readFileSync(new URL("./mobile-ota.cjs", import.meta.url)),
    );
    writeFileSync(join(dir, "apps/mobile/android/build.gradle"), "native-v1");
    writeFileSync(join(dir, "bun.lock"), "lock-v1");
    git("init", "-q");
    const commit = () => {
      git("add", ".");
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "fixture",
      );
    };
    const runtime = () =>
      execFileSync(process.execPath, [join(dir, "scripts/ci/mobile-ota.cjs")], {
        encoding: "utf8",
      }).trim();
    commit();
    const first = runtime();
    writeFileSync(join(dir, "apps/mobile/screen.tsx"), "JS-only change");
    commit();
    expect(runtime()).toBe(first);
    writeFileSync(join(dir, "apps/mobile/android/build.gradle"), "native-v2");
    commit();
    const second = runtime();
    expect(second).not.toBe(first);
    writeFileSync(join(dir, "bun.lock"), "lock-v2");
    commit();
    expect(runtime()).not.toBe(second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the installed release must have OTA enabled for the same project and channel", () => {
  const manifest = {
    enabled: true,
    projectId: "project",
    runtimeVersion: "runtime",
    channel: "production",
  };
  expect(() => ota.assertInstalledRuntime(manifest, manifest)).not.toThrow();
  for (const changed of [
    { enabled: false },
    { projectId: "other-project" },
    { runtimeVersion: "other-runtime" },
    { channel: "preview" },
  ]) {
    expect(() => ota.assertInstalledRuntime({ ...manifest, ...changed }, manifest)).toThrow(
      "base release",
    );
  }
  expect(() => ota.assertInstalledRuntime(manifest, { ...manifest, enabled: false })).toThrow();
});
