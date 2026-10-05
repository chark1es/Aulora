import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateVersion } from "./release-version.mjs";

test("release versions reject unsafe paths, prereleases, and Windows version overflow", () => {
  for (const version of ["v1.0.0", "1.0.0-beta.1", "1.0.0/../../other", "65536.0.0", "01.0.0"]) {
    expect(() => validateVersion(version)).toThrow();
  }
  expect(validateVersion("65535.65535.65535")).toBe("65535.65535.65535");
});

test("the release CLI writes the requested Tauri version override and rejects invalid input", async () => {
  const root = await mkdtemp(join(tmpdir(), "aulora-release-version-"));
  try {
    const script = fileURLToPath(new URL("./release-version.mjs", import.meta.url));
    const output = join(root, "version.json");
    const args = [script, "--version", "1.2.3", "--output", output];
    expect(spawnSync("node", args, { encoding: "utf8" }).status).toBe(0);
    expect(JSON.parse(await Bun.file(output).text())).toEqual({ version: "1.2.3" });
    args[2] = "65536.0.0";
    expect(spawnSync("node", args, { encoding: "utf8" }).status).not.toBe(0);
    expect(JSON.parse(await Bun.file(output).text())).toEqual({ version: "1.2.3" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
