import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createStagedUpdater } from "./stage.mjs";

const directories = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture(options = {}) {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "aulora-update-"));
  directories.push(repoRoot);
  const dockerDir = resolve(repoRoot, "infra/docker");
  mkdirSync(dockerDir, { recursive: true });
  writeFileSync(resolve(dockerDir, ".env"), "INSTANCE_NAME=fixture\n");
  writeFileSync(resolve(dockerDir, ".deployed-version"), "0.1.0\n");
  const calls = [];
  let imageId = "sha256:prepared";
  let failSetup = false;
  const plan = {
    currentVersion: "0.1.0",
    sourceVersion: "0.1.0",
    latestVersion: "0.2.0",
    deployedVersion: "0.1.0",
    updateAvailable: true,
    apply: "fast-forward",
    gitTag: "v0.2.0",
    notes: null,
    error: null,
    autoUpdate: false,
    checkedAt: new Date().toISOString(),
  };
  const execute = async (command, args, cwd) => {
    calls.push([command, args, cwd]);
    if (command === "git") {
      const operation = args[2];
      if (operation === "status") return options.dirty ? " M source.ts" : "";
      if (operation === "rev-parse") return args[3] === "HEAD" ? "basecommit" : "releasecommit";
      if (operation === "merge-base" && options.diverged) throw new Error("Not a fast-forward.");
      if (operation === "worktree" && args[3] === "add") {
        const stage = args[5];
        mkdirSync(resolve(stage, "infra/docker"), { recursive: true });
        mkdirSync(resolve(stage, "packages/convex/convex/lib"), { recursive: true });
        writeFileSync(
          resolve(stage, "packages/convex/convex/lib/env.ts"),
          `export const AULORA_VERSION = "${options.sourceVersion ?? "0.2.0"}";\n`,
        );
      }
    }
    if (command === "docker") {
      if (args[1] === "version") return options.composeVersion ?? "2.24.0";
      if (args[0] === "image") return imageId;
      if (args[0] === "inspect") return options.engineChanged ? "sha256:old-engine" : imageId;
      if (args[1] === "ps") return options.missingEngine ? "" : "engine-container";
      if (
        args.includes("--wait") &&
        options.failHealth &&
        (options.failHealth === "engine" || args.includes("web"))
      ) {
        throw new Error("Health timeout.");
      }
      if (args[1] === "config" && args.includes("--images")) return "engine:pinned";
      if (args[1] === "config")
        return JSON.stringify({
          name: "aulora",
          services: {
            "convex-backend": { image: "engine:pinned" },
            web: { image: "web:local" },
            setup: { image: "setup:local" },
            "smtp-gateway": { image: "smtp:local" },
            "bot-runner": { image: "bot-runner:local" },
          },
        });
      if (args[1] === "run" && failSetup) throw new Error("Setup failed.");
    }
    return "";
  };
  const updater = createStagedUpdater({ repoRoot, dockerDir, execute, check: async () => plan });
  return {
    updater,
    dockerDir,
    calls,
    setImage: (id) => {
      imageId = id;
    },
    failSetup: () => {
      failSetup = true;
    },
  };
}
describe("staged workspace updates", () => {
  it("prepares images without touching running containers, checkout HEAD, or deployed stamp", async () => {
    const f = fixture();
    await f.updater.download();
    expect(f.updater.ready()?.plan.latestVersion).toBe("0.2.0");
    expect(
      f.calls.some(([command, args]) => command === "docker" && ["up", "run"].includes(args[1])),
    ).toBe(false);
    expect(f.calls.some(([command, args]) => command === "git" && args[2] === "merge")).toBe(false);
    expect(readFileSync(resolve(f.dockerDir, ".deployed-version"), "utf8")).toBe("0.1.0\n");
    await f.updater.restart();
    expect(
      f.calls.some(
        ([command, args]) => command === "git" && args[2] === "merge" && args[3] === "--ff-only",
      ),
    ).toBe(true);
    expect(readFileSync(resolve(f.dockerDir, ".deployed-version"), "utf8")).toBe("0.2.0\n");
    expect(f.updater.ready()).toBeNull();
    expect(
      f.calls.some(
        ([command, args]) =>
          command === "docker" && args[1] === "up" && args.includes("bot-runner"),
      ),
    ).toBe(true);
    const setupIndex = f.calls.findIndex(
      ([command, args]) => command === "docker" && args[1] === "run" && args.includes("setup"),
    );
    const webIndex = f.calls.findIndex(
      ([command, args]) => command === "docker" && args[1] === "up" && args.includes("web"),
    );
    expect(setupIndex).toBeGreaterThan(-1);
    expect(webIndex).toBeGreaterThan(setupIndex);
  });
  it("requires a prepared release and refuses dirty or diverged checkouts", async () => {
    await expect(fixture().updater.restart()).rejects.toThrow("Download the update");
    const dirty = fixture({ dirty: true });
    await expect(dirty.updater.download()).rejects.toThrow("uncommitted changes");
    expect(dirty.calls.some(([command]) => command === "docker")).toBe(false);
    await expect(fixture({ diverged: true }).updater.download()).rejects.toThrow("fast-forward");
    await expect(fixture({ sourceVersion: "0.3.0" }).updater.download()).rejects.toThrow(
      "does not match",
    );
  });
  it("refuses changed configuration or substituted images before installing", async () => {
    const env = fixture();
    await env.updater.download();
    writeFileSync(resolve(env.dockerDir, ".env"), "INSTANCE_NAME=changed\n");
    await expect(env.updater.restart()).rejects.toThrow("configuration changed");
    const images = fixture();
    await images.updater.download();
    images.setImage("sha256:other");
    await expect(images.updater.restart()).rejects.toThrow("images have changed");
    expect(images.calls.some(([command, args]) => command === "docker" && args[1] === "up")).toBe(
      false,
    );
  });
  it("preserves the prepared release and old stamp after failed deployment for retry", async () => {
    const f = fixture();
    await f.updater.download();
    f.failSetup();
    await expect(f.updater.restart()).rejects.toThrow("Setup failed");
    expect(f.updater.ready()).not.toBeNull();
    expect(readFileSync(resolve(f.dockerDir, ".deployed-version"), "utf8")).toBe("0.1.0\n");
    expect(
      JSON.parse(readFileSync(resolve(f.dockerDir, ".update-status.json"), "utf8")),
    ).toMatchObject({ state: "ready", error: "Setup failed." });
    expect(existsSync(resolve(f.dockerDir, ".env"))).toBe(true);
  });
  it("recreates a changed engine and waits before setup, but keeps a matching engine", async () => {
    for (const engineChanged of [false, true]) {
      const f = fixture({ engineChanged });
      await f.updater.download();
      await f.updater.restart();
      const recreated = f.calls.findIndex(
        ([, args]) => args.includes("--force-recreate") && args.includes("convex-backend"),
      );
      expect(recreated !== -1).toBe(engineChanged);
      const wait = f.calls.findIndex(([, args]) => args.includes("--wait"));
      const setup = f.calls.findIndex(([, args]) => args[1] === "run" && args.includes("setup"));
      expect(wait).toBeGreaterThan(recreated);
      expect(setup).toBeGreaterThan(wait);
      expect(f.calls.at(wait)?.[1]).toContain("120");
    }
  });
  it("retains the ready marker and stamp on engine or final web health failure", async () => {
    for (const failHealth of ["engine", "web"]) {
      const f = fixture({ engineChanged: true, failHealth });
      await f.updater.download();
      await expect(f.updater.restart()).rejects.toThrow("Health timeout");
      expect(f.updater.ready()).not.toBeNull();
      expect(readFileSync(resolve(f.dockerDir, ".deployed-version"), "utf8")).toBe("0.1.0\n");
      expect(
        JSON.parse(readFileSync(resolve(f.dockerDir, ".update-status.json"), "utf8")),
      ).toMatchObject({ state: "ready", error: "Health timeout." });
      if (failHealth === "engine") {
        expect(f.calls.some(([, args]) => args[1] === "run")).toBe(false);
      }
    }
  });
});

it("starts dependencies before setup when the engine container is absent", async () => {
  const f = fixture({ missingEngine: true });
  await f.updater.download();
  await f.updater.restart();
  const start = f.calls.findIndex(
    ([, args]) =>
      args.join(" ") === "compose up -d --no-build --wait --wait-timeout 120 convex-backend",
  );
  const setup = f.calls.findIndex(([, args]) => args[1] === "run");
  expect(start).toBeGreaterThan(-1);
  expect(setup).toBeGreaterThan(start);
  expect(
    f.calls.some(
      ([, args]) => args.includes("--force-recreate") && args.includes("convex-backend"),
    ),
  ).toBe(false);
});

it("rejects an old Compose plugin before building images", async () => {
  const f = fixture({ composeVersion: "2.23.3" });
  await expect(f.updater.download()).rejects.toThrow("Docker Compose >= 2.24 is required");
  expect(f.calls.some(([command, args]) => command === "docker" && args[1] === "build")).toBe(
    false,
  );
});

it("probes the Compose version once per updater after a passing check", async () => {
  const f = fixture();
  await f.updater.download();
  const probes = f.calls.filter(([command, args]) => command === "docker" && args[1] === "version");
  expect(probes).toHaveLength(1);
});
