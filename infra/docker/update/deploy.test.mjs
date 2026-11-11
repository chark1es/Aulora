import { afterEach, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const directories = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

/** A scratch checkout: deploy.sh next to fake docker/bun binaries that only record calls. */
async function scratchCheckout() {
  const root = mkdtempSync(resolve(tmpdir(), "aulora-deploy-"));
  directories.push(root);
  const dockerDir = resolve(root, "infra/docker");
  // Bun.write creates missing parent directories, so no mkdir is needed.
  await Bun.write(
    resolve(root, "packages/convex/convex/lib/env.ts"),
    'export const AULORA_VERSION = "0.2.0";\n',
  );
  await Bun.write(resolve(dockerDir, ".deployed-version"), "0.1.0\n");
  await Bun.write(
    resolve(dockerDir, "deploy.sh"),
    Bun.file(new URL("../deploy.sh", import.meta.url)),
  );
  // No Docker daemon is used: the stubs record the command contract and inject failures.
  const bin = mkdtempSync(resolve(root, "bin-"));
  copyFileSync(fixture("docker-stub.sh"), resolve(bin, "docker"));
  copyFileSync(fixture("bun-stub.sh"), resolve(bin, "bun"));
  return { root, dockerDir, bin };
}

async function deploy({
  changed = false,
  missing = false,
  fail = "",
  composeVersion = "",
  engineImages = "",
  noCompose = false,
  args = [],
} = {}) {
  const { root, dockerDir, bin } = await scratchCheckout();
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
  const callsFileHandle = Bun.file(callsFile);
  const calls = ((await callsFileHandle.exists()) ? await callsFileHandle.text() : "").trim();
  return {
    result,
    calls: calls === "" ? [] : calls.split("\n"),
    stamp: await Bun.file(resolve(dockerDir, ".deployed-version")).text(),
  };
}

it("deploy keeps matching engines and waits for a changed engine before setup", async () => {
  for (const changed of [false, true]) {
    const f = await deploy({ changed });
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

it("deploy preserves the old stamp on engine or web health failure", async () => {
  for (const fail of ["engine", "web"]) {
    const f = await deploy({ changed: true, fail });
    expect(f.result.status).not.toBe(0);
    expect(f.stamp).toBe("0.1.0\n");
    if (fail === "engine") expect(f.calls).not.toContain("compose run --rm setup");
  }
});

it("deploy starts engine dependencies when there is no engine container", async () => {
  const f = await deploy({ missing: true });
  expect(f.result.status).toBe(0);
  expect(f.calls).toContain("compose up -d --no-build --wait --wait-timeout 120 convex-backend");
  // The first wait already gates on health; it must not be repeated for the engine alone.
  expect(f.calls.filter((call) => call.endsWith("--wait-timeout 120 convex-backend"))).toHaveLength(
    1,
  );
  expect(f.stamp).toBe("0.2.0\n");
});

it("deploy rejects an old Compose plugin before building", async () => {
  const f = await deploy({ composeVersion: "2.23.3" });
  expect(f.result.status).toBe(2);
  expect(f.result.stderr).toContain("Docker Compose >= 2.24 is required");
  expect(f.calls.some((call) => call.includes(" build "))).toBe(false);
});

it("deploy explains a missing Compose plugin instead of a raw docker error", async () => {
  const f = await deploy({ noCompose: true });
  expect(f.result.status).toBe(2);
  expect(f.result.stderr).toContain("Docker Compose >= 2.24 is required");
  expect(f.result.stderr).not.toContain("is not a docker command");
  expect(f.calls.some((call) => call.includes(" build "))).toBe(false);
});

it("deploy rejects a multi-line engine image result before touching the engine", async () => {
  const f = await deploy({ engineImages: "engine:pinned\\nengine:other" });
  expect(f.result.status).toBe(1);
  expect(f.result.stderr).toContain("Expected one engine image");
  expect(f.calls.some((call) => call.startsWith("compose up"))).toBe(false);
  expect(f.stamp).toBe("0.1.0\n");
});

it("rollback still runs on an old Compose plugin", async () => {
  const f = await deploy({ composeVersion: "2.20.0", args: ["--rollback"] });
  expect(f.result.status).toBe(0);
  expect(f.result.stderr).not.toContain("Docker Compose");
});

it("keeps the previous web and stamp when setup fails after starting a missing engine", async () => {
  const f = await deploy({ missing: true, fail: "setup" });
  expect(f.result.status).not.toBe(0);
  expect(f.stamp).toBe("0.1.0\n");
  expect(f.calls).toContain("compose up -d --no-build --wait --wait-timeout 120 convex-backend");
  expect(f.calls).toContain("compose run --rm setup");
  expect(f.calls.some((call) => call.includes("up ") && call.endsWith(" web"))).toBe(false);
});
