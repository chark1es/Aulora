import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The streaming profile's key generator runs in an Alpine container under
// `sh`. These tests run it with the host's `sh` against a temp directory, so
// they need a POSIX shell and are skipped on Windows.

const SCRIPT = fileURLToPath(new URL("../init-keys.sh", import.meta.url));
const skip = process.platform === "win32" ? "needs a POSIX shell" : false;

function run(dir) {
  return spawnSync("sh", [SCRIPT], { env: { ...process.env, KEYS_DIR: dir }, encoding: "utf8" });
}

function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "aulora-livekit-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("writes a quoted key pair only its owner can read", { skip }, () => {
  withTempDir((dir) => {
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const file = join(dir, "keys");
    assert.match(readFileSync(file, "utf8"), /^aulora: "[0-9a-f]{64}"\n$/);
    // LiveKit refuses a key file that other users can read.
    assert.equal(statSync(file).mode & 0o077, 0);
  });
});

test("keeps the existing key pair on later runs", { skip }, () => {
  withTempDir((dir) => {
    run(dir);
    const first = readFileSync(join(dir, "keys"), "utf8");
    const again = run(dir);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(join(dir, "keys"), "utf8"), first);
  });
});

test("never prints the secret", { skip }, () => {
  withTempDir((dir) => {
    const result = run(dir);
    const secret = readFileSync(join(dir, "keys"), "utf8").match(/"([0-9a-f]{64})"/)?.[1];
    assert.ok(secret);
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
  });
});

test("fails loudly when the volume is not writable", { skip }, () => {
  const result = run(join(tmpdir(), "aulora-livekit-missing-dir"));
  assert.notEqual(result.status, 0);
});
