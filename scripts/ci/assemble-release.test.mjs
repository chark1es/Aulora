import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleRelease, writeChecksums } from "./assemble-release.mjs";

test("release assembly keeps both Mac architectures and refuses incomplete releases", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aulora-release-test-"));
  try {
    const artifacts = [
      "Aulora_1.0.0_darwin-aarch64.app.tar.gz",
      "Aulora_1.0.0_darwin-x86_64.app.tar.gz",
      "Aulora_1.0.0_x64-setup.exe",
      "Aulora_1.0.0_amd64.AppImage",
    ];
    for (const file of artifacts) {
      writeFileSync(join(directory, file), "test artifact");
      writeFileSync(join(directory, `${file}.sig`), "test-signature");
    }
    await expect(assembleRelease(directory, "1.0.0", "chark1es/Aulora")).rejects.toThrow(
      "Missing release file",
    );
    for (const suffix of [
      "_android.apk",
      "_android.aab",
      "_ios.ipa",
      "_web.zip",
      "_docs.zip",
      "_legal.zip",
    ])
      writeFileSync(join(directory, `Aulora_1.0.0${suffix}`), "test artifact");
    await expect(assembleRelease(directory, "1.0.0", "chark1es/Aulora")).rejects.toThrow(
      "Missing release notice",
    );
    for (const file of [
      "LICENSE",
      "NOTICE",
      "COMMERCIAL.md",
      "THIRD_PARTY_NOTICES.md",
      "THIRD_PARTY_JAVASCRIPT.txt",
    ])
      writeFileSync(join(directory, file), "test notice");
    await assembleRelease(directory, "1.0.0", "chark1es/Aulora");
    const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
    expect(Object.keys(manifest.platforms)).toHaveLength(4);
    expect(manifest.platforms["darwin-aarch64"].url).not.toBe(
      manifest.platforms["darwin-x86_64"].url,
    );
    writeChecksums(directory);
    const digest = createHash("sha256").update("test artifact").digest("hex");
    expect(readFileSync(join(directory, "SHA256SUMS"), "utf8")).toContain(
      `${digest}  Aulora_1.0.0_android.apk`,
    );
    rmSync(join(directory, `${artifacts[0]}.sig`));
    await expect(assembleRelease(directory, "1.0.0", "chark1es/Aulora")).rejects.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
