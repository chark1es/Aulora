import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifests, generate, validateVersion } from "./winget.mjs";

const temporaryDirs = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("generation hashes the supplied file and emits three consistent YAML manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "aulora-winget-"));
  temporaryDirs.push(root);
  const bytes = Buffer.from("manifest generator fixture, not a Windows installer");
  const filename = "Aulora_1.0.0_x64-setup.exe";
  const installer = join(root, filename);
  await writeFile(installer, bytes);
  const output = join(root, "output");
  const manifestDir = await generate({ installer, version: "1.0.0", output });
  const checksum = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const documents = await Promise.all(
    ["", ".installer", ".locale.en-US"].map(async (suffix) =>
      Bun.YAML.parse(await readFile(join(manifestDir, `dev.spwnd.aulora${suffix}.yaml`), "utf8")),
    ),
  );
  for (const document of documents) {
    expect(document.PackageIdentifier).toBe("dev.spwnd.aulora");
    expect(document.PackageVersion).toBe("1.0.0");
  }
  expect(documents[1].Installers[0]).toEqual({
    Architecture: "x64",
    InstallerUrl: `https://github.com/chark1es/Aulora/releases/download/v1.0.0/${filename}`,
    InstallerSha256: checksum,
  });
  expect(documents[1].InstallerSwitches).toEqual({ Silent: "/S", SilentWithProgress: "/P" });
  expect(await readFile(join(output, "SHA256SUMS"), "utf8")).toBe(`${checksum}  ${filename}\n`);
});

test("wrong versions, architectures, and missing installer files cannot generate submission manifests", async () => {
  expect(() => createManifests("1.0.0", "Aulora_0.1.0_x64-setup.exe", "A".repeat(64))).toThrow();
  expect(() => createManifests("1.0.0", "Aulora_1.0.0_arm64-setup.exe", "A".repeat(64))).toThrow();
  expect(() => createManifests("1.0.0", "Aulora_1.0.0_x64-setup.exe", "TODO")).toThrow();
  for (const version of ["v1.0.0", "1.0.0-beta.1", "1.0.0/../../other", "65536.0.0", "01.0.0"]) {
    expect(() => validateVersion(version)).toThrow();
  }
  await expect(
    generate({
      installer: "/missing/Aulora_1.0.0_x64-setup.exe",
      version: "1.0.0",
      output: tmpdir(),
    }),
  ).rejects.toThrow();
});

test("public-download verification rejects inaccessible or changed assets before writing manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "aulora-winget-download-"));
  temporaryDirs.push(root);
  const installer = join(root, "Aulora_1.0.0_x64-setup.exe");
  await writeFile(installer, "local fixture");
  const output = join(root, "output");
  const fetch = spyOn(globalThis, "fetch");
  try {
    fetch.mockResolvedValueOnce(new Response("private", { status: 404 }));
    await expect(
      generate({ installer, version: "1.0.0", output, verifyDownload: true }),
    ).rejects.toThrow("HTTP 404");
    fetch.mockResolvedValueOnce(new Response("different release bytes"));
    await expect(
      generate({ installer, version: "1.0.0", output, verifyDownload: true }),
    ).rejects.toThrow("differs");
    await expect(access(output)).rejects.toThrow();
    fetch.mockResolvedValueOnce(new Response("local fixture"));
    await generate({ installer, version: "1.0.0", output, verifyDownload: true });
    await access(join(output, "SHA256SUMS"));
  } finally {
    fetch.mockRestore();
  }
});
