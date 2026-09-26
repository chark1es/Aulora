import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// These tests exercise the bash installer's argument/plan handling. They are
// skipped where bash is unavailable, and never run docker. A temp
// AULORA_ENV_FILE keeps them independent of any developer `.env`.

const INSTALL = fileURLToPath(new URL("../../../../install.sh", import.meta.url));

function hasBash() {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

// On Windows the `bash` on PATH is WSL, which neither receives Windows
// environment variables nor resolves `C:\...` script paths, so these tests run
// on Linux/macOS CI only.
const skip =
  process.platform === "win32"
    ? "run the installer tests on Linux or macOS"
    : hasBash()
      ? false
      : "bash is not available";

function makeEnvDir() {
  return mkdtempSync(join(tmpdir(), "aulora-install-"));
}

function run(args, envDir) {
  return spawnSync("bash", [INSTALL, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, AULORA_ENV_FILE: join(envDir, ".env") },
  });
}

test("--help prints usage and exits zero", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const result = run(["--help"], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /self-host installer/);
    assert.match(result.stdout, /--dry-run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry-run plans the stack without changing anything", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const result = run(
      [
        "--dry-run",
        "--name",
        "Acme",
        "--email",
        "owner@acme.test",
        "--password",
        "correct-horse-battery-staple",
        "--port",
        "9090",
      ],
      dir,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /docker compose up -d --build/);
    assert.match(result.stdout, /docker compose run --rm setup/);
    assert.match(result.stdout, /no changes made/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry-run with --backups plans the backup profile", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const result = run(
      [
        "--dry-run",
        "--backups",
        "--email",
        "owner@acme.test",
        "--password",
        "correct-horse-battery-staple",
      ],
      dir,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--profile backups up -d --build/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a short owner password is rejected", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const result = run(["--dry-run", "--email", "owner@acme.test", "--password", "short"], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at least 16 characters/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown option is rejected", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const result = run(["--nope"], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown option/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
