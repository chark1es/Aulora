import { afterEach, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const directories = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Every path below is a child of a throwaway mkdtemp() directory created by this test file.
// nosemgrep: javascript.lang.security.audit.detect-non-literal-fs-filename.detect-non-literal-fs-filename
const makeDir = (path) => mkdirSync(path, { recursive: true });
// nosemgrep: javascript.lang.security.audit.detect-non-literal-fs-filename.detect-non-literal-fs-filename
const put = (path, data, options) => writeFileSync(path, data, options);
// nosemgrep: javascript.lang.security.audit.detect-non-literal-fs-filename.detect-non-literal-fs-filename
const slurp = (path) => readFileSync(path, "utf8");
// nosemgrep: javascript.lang.security.audit.detect-non-literal-fs-filename.detect-non-literal-fs-filename
const slurpIfPresent = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const DOCKER_STUB = `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  'compose version --short')
    if [ "$NO_COMPOSE" = true ]; then echo "docker: 'compose' is not a docker command." >&2; exit 1; fi
    echo "\${COMPOSE_VERSION:-2.24.6}" ;;
  'compose config --images convex-backend') printf '%b\\n' "\${ENGINE_IMAGES:-engine:pinned}" ;;
  'image inspect --format {{.Id}} engine:pinned') echo sha256:target ;;
  'compose ps -a -q convex-backend') if [ "$MISSING_ENGINE" != true ]; then echo engine-container; fi ;;
  'inspect --format {{.Image}} engine-container') echo "$RUNNING_IMAGE" ;;
esac
if [[ "$*" == 'compose run --rm setup' && "$FAIL_HEALTH" == setup ]]; then exit 1; fi
if [[ "$*" == *--wait* ]]; then
  if [[ "$FAIL_HEALTH" == engine || ( "$FAIL_HEALTH" == web && "$*" == *web ) ]]; then exit 1; fi
fi
`;

/** A scratch checkout: deploy.sh next to fake docker/bun binaries that only record calls. */
function scratchCheckout() {
  const root = mkdtempSync(resolve(tmpdir(), "aulora-deploy-"));
  directories.push(root);
  const dockerDir = resolve(root, "infra/docker");
  const bin = resolve(root, "bin");
  makeDir(dockerDir);
  makeDir(bin);
  makeDir(resolve(root, "packages/convex/convex/lib"));
  put(
    resolve(root, "packages/convex/convex/lib/env.ts"),
    'export const AULORA_VERSION = "0.2.0";\n',
  );
  put(resolve(dockerDir, ".deployed-version"), "0.1.0\n");
  copyFileSync(new URL("../deploy.sh", import.meta.url), resolve(dockerDir, "deploy.sh"));
  // No Docker daemon is used: record the command contract and inject failures.
  put(resolve(bin, "docker"), DOCKER_STUB, { mode: 0o755 });
  put(resolve(bin, "bun"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  return { root, dockerDir, bin };
}

function deploy({
  changed = false,
  missing = false,
  fail = "",
  composeVersion = "",
  engineImages = "",
  noCompose = false,
  args = [],
} = {}) {
  const { root, dockerDir, bin } = scratchCheckout();
  const callsFile = resolve(root, "calls");
  const result = spawnSync("bash", [resolve(dockerDir, "deploy.sh"), ...args], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: callsFile,
      RUNNING_IMAGE: changed ? "sha256:old" : "sha256:target",
      FAIL_HEALTH: fail,
      MISSING_ENGINE: String(missing),
      NO_COMPOSE: String(noCompose),
      ...(engineImages ? { ENGINE_IMAGES: engineImages } : {}),
      ...(composeVersion ? { COMPOSE_VERSION: composeVersion } : {}),
    },
    encoding: "utf8",
  });
  const calls = slurpIfPresent(callsFile).trim();
  return {
    result,
    calls: calls === "" ? [] : calls.split("\n"),
    stamp: slurp(resolve(dockerDir, ".deployed-version")),
  };
}

it("deploy keeps matching engines and waits for a changed engine before setup", () => {
  for (const changed of [false, true]) {
    const f = deploy({ changed });
    expect(f.result.status).toBe(0);
    expect(f.stamp).toBe("0.2.0\n");
    expect(
      f.calls.includes("compose up -d --no-deps --no-build --force-recreate convex-backend"),
    ).toBe(changed);
    const setup = f.calls.indexOf("compose run --rm setup");
    const wait = f.calls.findIndex((call) => call.includes("--wait-timeout 120 convex-backend"));
    expect(wait).toBeGreaterThan(-1);
    expect(setup).toBeGreaterThan(wait);
    expect(f.calls.at(-1)).toContain("--wait-timeout 120 convex-backend web");
  }
});

it("deploy preserves the old stamp on engine or web health failure", () => {
  for (const fail of ["engine", "web"]) {
    const f = deploy({ changed: true, fail });
    expect(f.result.status).not.toBe(0);
    expect(f.stamp).toBe("0.1.0\n");
    if (fail === "engine") expect(f.calls).not.toContain("compose run --rm setup");
  }
});

it("deploy starts engine dependencies when there is no engine container", () => {
  const f = deploy({ missing: true });
  expect(f.result.status).toBe(0);
  expect(f.calls).toContain("compose up -d --no-build --wait --wait-timeout 120 convex-backend");
  // The first wait already gates on health; it must not be repeated for the engine alone.
  expect(f.calls.filter((call) => call.endsWith("--wait-timeout 120 convex-backend"))).toHaveLength(
    1,
  );
  expect(f.stamp).toBe("0.2.0\n");
});

it("deploy rejects an old Compose plugin before building", () => {
  const f = deploy({ composeVersion: "2.23.3" });
  expect(f.result.status).toBe(2);
  expect(f.result.stderr).toContain("Docker Compose >= 2.24 is required");
  expect(f.calls.some((call) => call.includes(" build "))).toBe(false);
});

it("deploy explains a missing Compose plugin instead of a raw docker error", () => {
  const f = deploy({ noCompose: true });
  expect(f.result.status).toBe(2);
  expect(f.result.stderr).toContain("Docker Compose >= 2.24 is required");
  expect(f.result.stderr).not.toContain("is not a docker command");
  expect(f.calls.some((call) => call.includes(" build "))).toBe(false);
});

it("deploy rejects a multi-line engine image result before touching the engine", () => {
  const f = deploy({ engineImages: "engine:pinned\\nengine:other" });
  expect(f.result.status).toBe(1);
  expect(f.result.stderr).toContain("Expected one engine image");
  expect(f.calls.some((call) => call.startsWith("compose up"))).toBe(false);
  expect(f.stamp).toBe("0.1.0\n");
});

it("rollback still runs on an old Compose plugin", () => {
  const f = deploy({ composeVersion: "2.20.0", args: ["--rollback"] });
  expect(f.result.status).toBe(0);
  expect(f.result.stderr).not.toContain("Docker Compose");
});

it("keeps the previous web and stamp when setup fails after starting a missing engine", () => {
  const f = deploy({ missing: true, fail: "setup" });
  expect(f.result.status).not.toBe(0);
  expect(f.stamp).toBe("0.1.0\n");
  expect(f.calls).toContain("compose up -d --no-build --wait --wait-timeout 120 convex-backend");
  expect(f.calls).toContain("compose run --rm setup");
  expect(f.calls.some((call) => call.includes("up ") && call.endsWith(" web"))).toBe(false);
});
