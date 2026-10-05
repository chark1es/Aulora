import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleRelease, writeChecksums } from "./assemble-release.mjs";

const ARTIFACTS = [
  "Aulora_1.0.0_darwin-aarch64.app.tar.gz",
  "Aulora_1.0.0_darwin-x86_64.app.tar.gz",
  "Aulora_1.0.0_x64-setup.exe",
  "Aulora_1.0.0_amd64.AppImage",
];
const EXTRA_SUFFIXES = [
  "_android.apk",
  "_android.aab",
  "_ios.ipa",
  "_web.zip",
  "_docs.zip",
  "_legal.zip",
];
const NOTICES = [
  "LICENSE",
  "NOTICE",
  "COMMERCIAL.md",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_JAVASCRIPT.txt",
];

function writeAll(directory, names, content) {
  for (const name of names) writeFileSync(join(directory, name), content);
}

test("release assembly keeps both Mac architectures and refuses incomplete releases", async () => {
  const work = mkdtempSync(join(tmpdir(), "aulora-release-test-"));
  const dist = join(work, "dist", "release");
  mkdirSync(dist, { recursive: true });
  const previousCwd = process.cwd();
  try {
    process.chdir(work);
    writeAll(dist, ARTIFACTS, "test artifact");
    for (const file of ARTIFACTS) writeFileSync(join(dist, `${file}.sig`), "test-signature");
    await expect(assembleRelease("1.0.0", "chark1es/Aulora")).rejects.toThrow(
      "Missing release file",
    );
    for (const suffix of EXTRA_SUFFIXES)
      writeFileSync(join(dist, `Aulora_1.0.0${suffix}`), "test artifact");
    await expect(assembleRelease("1.0.0", "chark1es/Aulora")).rejects.toThrow(
      "Missing release notice",
    );
    writeAll(dist, NOTICES, "test notice");
    const notes = "## Changes\n\n- Release notes shared with GitHub.\n";
    await assembleRelease("1.0.0", "chark1es/Aulora", notes);
    const manifest = JSON.parse(readFileSync(join(dist, "latest.json"), "utf8"));
    expect(manifest.notes).toBe(notes);
    expect(Object.keys(manifest.platforms)).toHaveLength(4);
    expect(manifest.platforms["darwin-aarch64"].url).not.toBe(
      manifest.platforms["darwin-x86_64"].url,
    );
    writeChecksums();
    const digest = createHash("sha256").update("test artifact").digest("hex");
    expect(readFileSync(join(dist, "SHA256SUMS"), "utf8")).toContain(
      `${digest}  Aulora_1.0.0_android.apk`,
    );
    rmSync(join(dist, `${ARTIFACTS[0]}.sig`));
    await expect(assembleRelease("1.0.0", "chark1es/Aulora")).rejects.toThrow();
  } finally {
    process.chdir(previousCwd);
    rmSync(work, { recursive: true, force: true });
  }
});
