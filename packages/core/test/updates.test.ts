import { describe, expect, it } from "vitest";
import {
  autoUpdateEnabled,
  compareSemver,
  loadPublishedRelease,
  parseSemver,
  planWorkspaceUpdate,
  readDeclaredVersion,
  releaseTag,
  resolveGitHubRepo,
  resolveManifestUrl,
  updateChannel,
} from "../src/updates";

const manifest = {
  version: "0.2.0",
  notes: "Faster calls.",
  pub_date: "2026-09-29T12:00:00Z",
  platforms: {
    "darwin-aarch64": { signature: "sig", url: "https://example.com/Aulora.app.tar.gz" },
  },
  workspace: { version: "0.2.0", gitTag: "v0.2.0" },
};

describe("semver", () => {
  it("orders stable versions and treats a prerelease as older", () => {
    const older = parseSemver("0.1.0");
    const newer = parseSemver("v0.2.0");
    const candidate = parseSemver("0.2.0-rc.1");
    const built = parseSemver("0.2.0+build.4");
    if (older === null || newer === null || candidate === null || built === null) {
      throw new Error("expected versions to parse");
    }
    expect(compareSemver(newer, older)).toBeGreaterThan(0);
    expect(compareSemver(candidate, newer)).toBeLessThan(0);
    expect(compareSemver(built, newer)).toBe(0);
    expect(parseSemver("01.0.0")).toBeNull();
    expect(releaseTag("0.2.0")).toBe("v0.2.0");
  });
});

describe("planWorkspaceUpdate", () => {
  it("fast-forwards when the published release is newer than the checkout", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.1.0",
        channel: "stable",
        manifest,
      }),
    ).toMatchObject({
      updateAvailable: true,
      apply: "fast-forward",
      latestVersion: "0.2.0",
      gitTag: "v0.2.0",
      notes: "Faster calls.",
      error: null,
    });
  });

  it("redeploys when the checkout already has the release but containers do not", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.2.0",
        deployedVersion: "0.1.0",
        channel: "stable",
        manifest,
      }).apply,
    ).toBe("redeploy");
  });

  it("does not downgrade a newer checkout", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.3.0",
        channel: "stable",
        manifest,
      }),
    ).toMatchObject({ updateAvailable: false, apply: "none" });
  });

  it("ignores a prerelease on the stable channel", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.1.0",
        channel: "stable",
        manifest: {
          ...manifest,
          version: "0.2.0-rc.1",
          workspace: { version: "0.2.0-rc.1", gitTag: "v0.2.0-rc.1" },
        },
      }),
    ).toMatchObject({ updateAvailable: false, latestVersion: null, error: null });
  });

  it("accepts a prerelease on the beta channel", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.1.0",
        channel: "beta",
        githubRelease: {
          tag_name: "v0.2.0-rc.1",
          prerelease: true,
          body: "candidate",
          published_at: "2026-09-29T12:00:00Z",
        },
      }),
    ).toMatchObject({ updateAvailable: true, apply: "fast-forward", gitTag: "v0.2.0-rc.1" });
  });

  it("rejects a git tag that does not match the version", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.1.0",
        channel: "stable",
        manifest: { version: "0.2.0", workspace: { version: "0.2.0", gitTag: "v9.9.9" } },
      }).error,
    ).toMatch(/git tag/);
  });

  it("rejects a tag that is not a release ref", () => {
    expect(
      planWorkspaceUpdate({
        sourceVersion: "0.1.0",
        channel: "stable",
        githubRelease: { tag_name: "main", draft: false },
      }).error,
    ).toMatch(/tag/);
  });
});

describe("release feed", () => {
  it("reads the declared version and the operator overrides", () => {
    expect(readDeclaredVersion('export const AULORA_VERSION = "0.1.0";\n')).toBe("0.1.0");
    expect(updateChannel("beta")).toBe("beta");
    expect(updateChannel("stable")).toBe("stable");
    expect(autoUpdateEnabled("true")).toBe(true);
    expect(autoUpdateEnabled("false")).toBe(false);
    expect(resolveGitHubRepo("chark1es/Aulora")).toEqual({ repo: "chark1es/Aulora" });
    expect(resolveGitHubRepo("https://github.com/x/y")).toEqual({
      error: "Update repository must look like owner/name.",
    });
    expect(resolveManifestUrl("http://example.com/latest.json")).toEqual({
      error: "Update manifest URL must use https.",
    });
  });

  it("uses a manifest and falls back to GitHub when it is missing", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (String(url).includes("latest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const found = await loadPublishedRelease({
      manifestUrl: "https://example.com/latest.json",
      githubRepo: "chark1es/Aulora",
      channel: "stable",
      fetchImpl,
    });
    expect(found.manifest).toMatchObject({ version: "0.2.0" });
    expect(found.githubRelease).toBeUndefined();
    expect(calls).toEqual(["https://example.com/latest.json"]);

    const fallback = await loadPublishedRelease({
      manifestUrl: "https://example.com/latest.json",
      githubRepo: "chark1es/Aulora",
      channel: "stable",
      fetchImpl: (async (url: string) => {
        if (String(url).includes("latest.json")) {
          return new Response("missing", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            tag_name: "v0.3.0",
            body: "ship",
            published_at: "2026-10-01T00:00:00Z",
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    expect(fallback.githubRelease).toMatchObject({ tag_name: "v0.3.0" });
  });
});
