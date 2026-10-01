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
      if (args[0] === "image") return imageId;
      if (args[1] === "config")
        return JSON.stringify({
          name: "aulora",
          services: {
            web: { image: "web:local" },
            setup: { image: "setup:local" },
            "smtp-gateway": { image: "smtp:local" },
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
});
