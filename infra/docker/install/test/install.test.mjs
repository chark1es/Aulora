import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// These tests exercise the bash installer's argument/plan handling. They are
// skipped where bash is unavailable, and never run docker. A temp
// AULORA_ENV_FILE keeps them independent of any developer `.env`.

const INSTALL = fileURLToPath(new URL("../../../../install.sh", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

// The installer moves a clean checkout onto the newest release tag unless it is
// told not to. Tests run from whatever checkout CI gives them (often detached,
// without tags), so every run opts out unless it uses its own scratch repository.
process.env.AULORA_ALLOW_ANY_BRANCH = "1";

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

// The installer requires Compose 2.24+; stubs answer the version probe.
const VERSION_CASE = `if [ "$*" = "compose version --short" ]; then echo "\${COMPOSE_VERSION:-2.24.6}"; exit 0; fi`;
function dockerStub() {
  return `#!/usr/bin/env bash\n${VERSION_CASE}\nexit 0\n`;
}

function makeEnvDir() {
  return mkdtempSync(join(tmpdir(), "aulora-install-"));
}

// Every run gets the docker stub first on PATH, so no test needs Docker Compose
// on the host (in WSL, `docker` is a Desktop shim that may not answer at all).
function run(args, envDir, extraEnv = {}) {
  const bin = join(envDir, "docker-stub");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), dockerStub(), { mode: 0o755 });
  return spawnSync("bash", [INSTALL, ...args], {
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      AULORA_ENV_FILE: join(envDir, ".env"),
      PATH: `${bin}:${process.env.PATH}`,
      ...extraEnv,
    },
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
    assert.match(result.stdout, /docker compose up -d --(no-)?build/);
    assert.match(result.stdout, /docker compose wait setup/);
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
    assert.match(result.stdout, /--profile backups up -d/);
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

test("an existing configuration prints its actual URL and owner without evaluating it", {
  skip,
}, () => {
  const dir = makeEnvDir();
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), dockerStub(), { mode: 0o755 });
    const file = join(dir, ".env");
    const content =
      'SITE_URL="http://localhost:18080"\nWEB_PORT=18080\nOWNER_EMAIL=owner@example.test\nUNUSED=$(touch should-not-exist)\n';
    writeFileSync(file, content);
    const result = spawnSync("bash", [INSTALL], {
      cwd: dir,
      encoding: "utf8",
      input: "",
      env: { ...process.env, AULORA_ENV_FILE: file, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Open http:\/\/localhost:18080 and sign in as owner@example.test/);
    assert.equal(readFileSync(file, "utf8"), content);
    assert.throws(() => readFileSync(join(dir, "should-not-exist")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry-run with --auto-update plans the host updater flag", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const result = run(
      [
        "--dry-run",
        "--auto-update",
        "--email",
        "owner@acme.test",
        "--password",
        "correct-horse-battery-staple",
      ],
      dir,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /AULORA_AUTO_UPDATE=true/);
    assert.match(result.stdout, /no changes made/);
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

test("a fresh install writes a bot runner token before the stack starts", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), dockerStub(), { mode: 0o755 });
    const result = spawnSync(
      "bash",
      [INSTALL, "--email", "owner@acme.test", "--password", "correct horse battery staple"],
      {
        encoding: "utf8",
        input: "",
        env: {
          ...process.env,
          AULORA_ENV_FILE: join(dir, ".env"),
          PATH: `${bin}:${process.env.PATH}`,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(join(dir, ".env"), "utf8");
    const token = env.match(/^BOT_RUNNER_TOKEN=(.*)$/m)?.[1] ?? "";
    assert.match(token, /^[A-Za-z0-9_-]{48,}$/);
    assert.match(env, /^BOT_RUNNER_ENABLED=true$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installer waits for Compose setup instead of launching a conflicting second setup", {
  skip,
}, () => {
  const dir = makeEnvDir();
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(dir, ".env"),
      "SITE_URL=http://localhost:18080\nOWNER_EMAIL=owner@example.test\n",
    );
    writeFileSync(
      join(bin, "docker"),
      `#!/usr/bin/env bash
${VERSION_CASE}
printf '%s\\n' "$*" >> "$INSTALL_TEST_LOG"
for arg in "$@"; do
  case "$arg" in
    up) touch "$INSTALL_SETUP_ACTIVE" ;;
    run) if [ -f "$INSTALL_SETUP_ACTIVE" ]; then
      echo 'Environment variables have changed during push' >&2
      exit 1
    fi ;;
    wait) rm -f "$INSTALL_SETUP_ACTIVE" ;;
  esac
done
exit 0
`,
      { mode: 0o755 },
    );
    const log = join(dir, "commands");
    const result = spawnSync("bash", [INSTALL], {
      encoding: "utf8",
      input: "",
      env: {
        ...process.env,
        AULORA_ENV_FILE: join(dir, ".env"),
        PATH: `${bin}:${process.env.PATH}`,
        INSTALL_TEST_LOG: log,
        INSTALL_SETUP_ACTIVE: join(dir, "setup-active"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(log, "utf8");
    assert.match(commands, / wait setup/);
    assert.ok(!commands.includes("run --rm setup"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installer recreates the bot runner after setup so it reads the generated token", {
  skip,
}, () => {
  const dir = makeEnvDir();
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(dir, ".env"),
      "SITE_URL=http://localhost:18080\nOWNER_EMAIL=owner@example.test\n",
    );
    writeFileSync(
      join(bin, "docker"),
      `#!/usr/bin/env bash
${VERSION_CASE}
printf '%s\\n' "$*" >> "$INSTALL_TEST_LOG"
exit 0
`,
      { mode: 0o755 },
    );
    const log = join(dir, "commands");
    const result = spawnSync("bash", [INSTALL], {
      encoding: "utf8",
      input: "",
      env: {
        ...process.env,
        AULORA_ENV_FILE: join(dir, ".env"),
        PATH: `${bin}:${process.env.PATH}`,
        INSTALL_TEST_LOG: log,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(log, "utf8").trim().split("\n");
    const setup = commands.findIndex((line) => line.includes("wait setup"));
    const runner = commands.findIndex(
      (line) =>
        line.includes("up -d --no-deps --force-recreate bot-runner") && line.includes("--env-file"),
    );
    assert.ok(setup !== -1, commands.join(" | "));
    assert.ok(runner > setup, `bot runner should start after setup: ${commands.join(" | ")}`);
    const transcriber = commands.findIndex(
      (line) =>
        line.includes("up -d --no-deps --force-recreate transcriber") &&
        line.includes("--env-file"),
    );
    assert.ok(transcriber > setup, `transcriber should start after setup: ${commands.join(" | ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A scratch clone of a repository that publishes v1.0.0 and v1.1.0 (plus a
// pre-release tag the installer must ignore). The clone sits on an older commit
// so the installer has to move it.
function releaseFixture() {
  const dir = makeEnvDir();
  const git = (cwd, ...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t.test",
        "-c",
        "protocol.file.allow=always",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const upstream = join(dir, "upstream");
  mkdirSync(upstream, { recursive: true });
  git(upstream, "init", "-q", "-b", "main");
  cpSync(INSTALL, join(upstream, "install.sh"));
  mkdirSync(join(upstream, "infra/docker"), { recursive: true });
  cpSync(join(REPO_ROOT, "infra/docker/.env.example"), join(upstream, "infra/docker/.env.example"));
  const commit = (message) => {
    writeFileSync(join(upstream, "marker.txt"), message);
    git(upstream, "add", ".");
    git(upstream, "commit", "-q", "-m", message);
  };
  commit("one");
  git(upstream, "tag", "v1.0.0");
  commit("two");
  git(upstream, "tag", "v1.1.0");
  git(upstream, "tag", "v1.2.0-beta.1");
  commit("three");
  const clone = join(dir, "clone");
  git(dir, "clone", "-q", upstream, clone);
  return { dir, clone, git, head: () => git(clone, "rev-parse", "HEAD") };
}

function runFrom(clone, dir, args, extraEnv = {}) {
  const bin = join(dir, "docker-stub");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), dockerStub(), { mode: 0o755 });
  const env = {
    ...process.env,
    AULORA_ENV_FILE: join(dir, ".env"),
    PATH: `${bin}:${process.env.PATH}`,
  };
  env.AULORA_ALLOW_ANY_BRANCH = "";
  return spawnSync("bash", [join(clone, "install.sh"), ...args], {
    encoding: "utf8",
    input: "",
    env: { ...env, ...extraEnv },
  });
}
const OWNER = ["--email", "owner@acme.test", "--password", "correct-horse-battery-staple"];

test("a checkout off a release tag moves to the newest stable release and re-runs", {
  skip,
}, () => {
  const f = releaseFixture();
  try {
    const result = runFrom(f.clone, f.dir, [...OWNER, "--no-start"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /checking out release v1\.1\.0/);
    assert.equal(f.head(), f.git(f.clone, "rev-list", "-n", "1", "v1.1.0"));
    assert.equal(f.git(f.clone, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
    // The re-run reached the end of the installer.
    assert.match(result.stdout, /config ready/);
    assert.ok(existsSync(join(f.dir, ".env")));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a checkout already at a stable release tag is left alone", { skip }, () => {
  const f = releaseFixture();
  try {
    f.git(f.clone, "checkout", "-q", "--detach", "v1.0.0");
    const result = runFrom(f.clone, f.dir, [...OWNER, "--no-start"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /checking out release/);
    assert.equal(f.head(), f.git(f.clone, "rev-list", "-n", "1", "v1.0.0"));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--dry-run reports the release it would use without switching", { skip }, () => {
  const f = releaseFixture();
  try {
    const before = f.head();
    const result = runFrom(f.clone, f.dir, [...OWNER, "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would check out release v1\.1\.0/);
    assert.equal(f.head(), before);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a dirty checkout is not switched and warns", { skip }, () => {
  const f = releaseFixture();
  try {
    const before = f.head();
    writeFileSync(join(f.clone, "marker.txt"), "local edit");
    const result = runFrom(f.clone, f.dir, [...OWNER, "--no-start"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /local changes/);
    assert.equal(f.head(), before);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--allow-any-branch and AULORA_ALLOW_ANY_BRANCH keep a non-release checkout", { skip }, () => {
  const f = releaseFixture();
  try {
    const before = f.head();
    const attempts = [
      { args: [...OWNER, "--no-start", "--allow-any-branch"], env: {} },
      { args: [...OWNER, "--no-start"], env: { AULORA_ALLOW_ANY_BRANCH: "1" } },
    ];
    for (const attempt of attempts) {
      const result = runFrom(f.clone, f.dir, attempt.args, attempt.env);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /checking out release/);
      assert.equal(f.head(), before);
      rmSync(join(f.dir, ".env"), { force: true });
    }
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a release checkout pulls images; a development checkout builds them", { skip }, () => {
  const f = releaseFixture();
  try {
    // The scratch repository has no packages/convex, so tag a checkout whose
    // env.ts declares the version the tag names.
    const writeVersion = (version) => {
      mkdirSync(join(f.clone, "packages/convex/convex/lib"), { recursive: true });
      writeFileSync(
        join(f.clone, "packages/convex/convex/lib/env.ts"),
        `export const AULORA_VERSION = "${version}";\n`,
      );
    };
    f.git(f.clone, "checkout", "-q", "--detach", "v1.0.0");
    writeVersion("1.0.0");
    f.git(f.clone, "add", ".");
    f.git(f.clone, "commit", "-q", "-m", "version");
    f.git(f.clone, "tag", "v1.0.1");
    writeVersion("1.0.1");
    const release = runFrom(f.clone, f.dir, [...OWNER, "--dry-run"]);
    assert.match(release.stdout, /docker compose pull/);
    assert.match(release.stdout, /up -d --no-build/);
    writeVersion("9.9.9");
    f.git(f.clone, "checkout", "-q", "--", ".");
    const development = runFrom(f.clone, f.dir, [...OWNER, "--dry-run", "--allow-any-branch"]);
    assert.match(development.stdout, /up -d --build/);
    assert.doesNotMatch(development.stdout, /docker compose pull/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("installer rejects Docker Compose older than 2.24 before touching anything", { skip }, () => {
  const dir = makeEnvDir();
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), dockerStub(), { mode: 0o755 });
    for (const version of ["2.23.3", "1.29.2", ""]) {
      const result = spawnSync(
        "bash",
        [INSTALL, "--email", "owner@acme.test", "--password", "correct horse battery staple"],
        {
          encoding: "utf8",
          input: "",
          env: {
            ...process.env,
            AULORA_ENV_FILE: join(dir, ".env"),
            PATH: `${bin}:${process.env.PATH}`,
            COMPOSE_VERSION: version || "unknown",
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Docker Compose 2\.24 or newer is required/);
    }
    assert.equal(existsSync(join(dir, ".env")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
