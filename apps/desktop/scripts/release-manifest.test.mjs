import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planWorkspaceUpdate } from "../../../packages/core/src/updates.ts";
import { buildReleaseManifest, platformFromFile, validateVersion } from "./release-manifest.mjs";

describe("release manifest", () => {
  it("rejects prerelease versions and placeholder signatures", () => {
    expect(() => validateVersion("1.0.0-rc.1")).toThrow(/stable version/);
    expect(() =>
      buildReleaseManifest({
        version: "1.0.0",
        pubDate: "2026-09-29T00:00:00.000Z",
        platforms: [
          { target: "darwin-aarch64", url: "https://example.com/a", signature: "PLACEHOLDER" },
        ],
      }),
    ).toThrow(/sig file/);
  });

  it("builds a feed the workspace updater can plan from", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aulora-release-"));
    try {
      const artifact = join(dir, "Aulora.app.tar.gz");
      await writeFile(artifact, "bytes");
      await writeFile(`${artifact}.sig`, "minisign-signature\n");
      const platform = await platformFromFile(
        "darwin-aarch64",
        artifact,
        "https://github.com/chark1es/Aulora/releases/download/v1.2.3",
      );
      const manifest = buildReleaseManifest({
        version: "1.2.3",
        notes: "Signed build.",
        pubDate: "2026-09-29T00:00:00.000Z",
        platforms: [
          platform,
          {
            target: "darwin-x86_64",
            url: platform.url,
            signature: platform.signature,
          },
        ],
      });
      expect(manifest.workspace).toEqual({ version: "1.2.3", gitTag: "v1.2.3" });
      expect(manifest.platforms["darwin-aarch64"].url).toBe(
        "https://github.com/chark1es/Aulora/releases/download/v1.2.3/Aulora.app.tar.gz",
      );
      expect(manifest.platforms["darwin-aarch64"].signature).toBe("minisign-signature");
      expect(
        planWorkspaceUpdate({ sourceVersion: "1.2.0", channel: "stable", manifest }),
      ).toMatchObject({ apply: "fast-forward", gitTag: "v1.2.3" });
      await writeFile(join(dir, "latest.json"), JSON.stringify(manifest));
      expect(JSON.parse(await readFile(join(dir, "latest.json"), "utf8")).version).toBe("1.2.3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
