/* eslint-disable security/detect-non-literal-fs-filename -- Paths are the repository checkout, build output or a temp fixture, joined from fixed names or this script's own arguments, never request data. */
/* eslint-disable security/detect-object-injection -- Keys come from files in this checkout and fixed tables, and index loops are bounded by the array they walk; nothing here is request input. */
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  FAILED_WEB_IMAGE,
  PREVIOUS_WEB_IMAGE,
  pinCurrentWebImage,
  rollbackWeb,
  STATE_FILE,
  WEB_IMAGE,
} from "./rollback.mjs";

const directories = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(images = { [WEB_IMAGE]: "sha256:old" }) {
  const dockerDir = mkdtempSync(resolve(tmpdir(), "aulora-rollback-"));
  directories.push(dockerDir);
  mkdirSync(dockerDir, { recursive: true });
  writeFileSync(resolve(dockerDir, ".deployed-version"), "1.2.3\n");
  const calls = [];
  const execute = async (command, args, cwd) => {
    calls.push([command, args, cwd]);
    if (command === "docker" && args[0] === "image") {
      const name = args.at(-1);
      const id = images[name];
      if (id === undefined) throw new Error(`missing image ${name}`);
      return id;
    }
    return "";
  };
  return {
    dockerDir,
    calls,
    execute,
    images,
    state: () => JSON.parse(readFileSync(resolve(dockerDir, STATE_FILE), "utf8")),
  };
}

describe("web image rollback", () => {
  it("pins the current web image and deployed version before a rebuild", async () => {
    const f = fixture();
    const state = await pinCurrentWebImage({
      dockerDir: f.dockerDir,
      execute: f.execute,
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    expect(state).toEqual({
      imageId: "sha256:old",
      version: "1.2.3",
      pinnedAt: "2026-01-02T03:04:05.000Z",
    });
    expect(f.state()).toEqual(state);
    expect(f.calls).toContainEqual([
      "docker",
      ["tag", "sha256:old", PREVIOUS_WEB_IMAGE],
      f.dockerDir,
    ]);
  });

  it("pins the running container image even when the local tag moved", async () => {
    const f = fixture({ [WEB_IMAGE]: "sha256:never-served" });
    const execute = async (command, args, cwd) => {
      f.calls.push([command, args, cwd]);
      if (command === "docker" && args[1] === "ps") return "container-1";
      if (command === "docker" && args[1] === "inspect") return "sha256:serving";
      return "";
    };
    const state = await pinCurrentWebImage({ dockerDir: f.dockerDir, execute });
    expect(state?.imageId).toBe("sha256:serving");
    expect(f.calls).toContainEqual([
      "docker",
      ["tag", "sha256:serving", PREVIOUS_WEB_IMAGE],
      f.dockerDir,
    ]);
  });

  it("does not fail a first deployment when no web image exists", async () => {
    const f = fixture({});
    expect(await pinCurrentWebImage({ dockerDir: f.dockerDir, execute: f.execute })).toBeNull();
    expect(existsSync(resolve(f.dockerDir, STATE_FILE))).toBe(false);
  });

  it("restores the pinned image, keeps the failed one, and recreates only web", async () => {
    const f = fixture({ [WEB_IMAGE]: "sha256:old" });
    await pinCurrentWebImage({ dockerDir: f.dockerDir, execute: f.execute });
    f.images[PREVIOUS_WEB_IMAGE] = "sha256:old";
    f.images[WEB_IMAGE] = "sha256:new";
    writeFileSync(resolve(f.dockerDir, ".deployed-version"), "1.3.0\n");
    const logs = [];

    await rollbackWeb({
      dockerDir: f.dockerDir,
      execute: f.execute,
      log: (message) => logs.push(message),
    });

    expect(f.calls).toContainEqual(["docker", ["tag", WEB_IMAGE, FAILED_WEB_IMAGE], f.dockerDir]);
    expect(f.calls).toContainEqual(["docker", ["tag", PREVIOUS_WEB_IMAGE, WEB_IMAGE], f.dockerDir]);
    expect(f.calls).toContainEqual([
      "docker",
      ["compose", "up", "-d", "--no-deps", "--no-build", "--force-recreate", "web"],
      f.dockerDir,
    ]);
    expect(readFileSync(resolve(f.dockerDir, ".deployed-version"), "utf8")).toBe("1.2.3\n");
    expect(logs.at(-1)).toContain("1.2.3");
  });

  it("refuses rollback without a pin, with a changed pin, or when already rolled back", async () => {
    const missing = fixture();
    await expect(
      rollbackWeb({ dockerDir: missing.dockerDir, execute: missing.execute }),
    ).rejects.toThrow("No pinned web image");

    const changed = fixture({ [WEB_IMAGE]: "sha256:old" });
    await pinCurrentWebImage({ dockerDir: changed.dockerDir, execute: changed.execute });
    changed.images[PREVIOUS_WEB_IMAGE] = "sha256:different";
    await expect(
      rollbackWeb({ dockerDir: changed.dockerDir, execute: changed.execute }),
    ).rejects.toThrow("changed");

    const current = fixture({ [WEB_IMAGE]: "sha256:old" });
    await pinCurrentWebImage({ dockerDir: current.dockerDir, execute: current.execute });
    current.images[PREVIOUS_WEB_IMAGE] = "sha256:old";
    await expect(
      rollbackWeb({ dockerDir: current.dockerDir, execute: current.execute }),
    ).rejects.toThrow("already");
  });
});
