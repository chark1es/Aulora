import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isSafeBotId, resolveWithin, safeRelativePath, writeBundleFiles } from "../src/store.mjs";

test("safeRelativePath accepts the documented file paths", () => {
  assert.equal(safeRelativePath("main.mjs"), "main.mjs");
  assert.equal(safeRelativePath("src/lib/bot.ts"), "src/lib/bot.ts");
  assert.equal(safeRelativePath("requirements.txt"), "requirements.txt");
  assert.equal(safeRelativePath("a/b/c/d.py"), "a/b/c/d.py");
});

test("safeRelativePath rejects traversal and disallowed shapes", () => {
  for (const bad of [
    "../escape.mjs",
    "a/../../b",
    "/etc/passwd",
    "node_modules/x",
    "a//b",
    ".",
    "..",
    "a/./b",
    "a b",
    "a\\b",
    "",
    "x".repeat(129),
    null,
    42,
  ]) {
    assert.equal(safeRelativePath(bad), null, `expected ${String(bad)} to be rejected`);
  }
});

test("resolveWithin refuses paths that escape the root", () => {
  const root = "/work/bot";
  assert.equal(resolveWithin(root, "main.mjs"), "/work/bot/main.mjs");
  assert.equal(resolveWithin(root, "../other/main.mjs"), null);
  assert.equal(resolveWithin(root, "/etc/passwd"), null);
});

test("isSafeBotId accepts ids used as directory names only", () => {
  assert.equal(isSafeBotId("bot_abc123"), true);
  assert.equal(isSafeBotId("k17abc-XYZ_9"), true);
  assert.equal(isSafeBotId("../escape"), false);
  assert.equal(isSafeBotId("a/b"), false);
  assert.equal(isSafeBotId(""), false);
  assert.equal(isSafeBotId("x".repeat(129)), false);
});

test("writeBundleFiles writes files with restrictive modes and refuses traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "aulora-store-"));
  try {
    writeBundleFiles(root, [
      { path: "main.mjs", content: "console.log('hi');" },
      { path: "src/lib/mod.ts", content: "export {};" },
    ]);
    assert.equal(readFileSync(join(root, "main.mjs"), "utf8"), "console.log('hi');");
    assert.equal(readFileSync(join(root, "src/lib/mod.ts"), "utf8"), "export {};");
    assert.equal(statSync(join(root, "main.mjs")).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, "src")).mode & 0o777, 0o700);

    assert.throws(
      () => writeBundleFiles(root, [{ path: "../escape.mjs", content: "boom" }]),
      /unsafe bot file path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
