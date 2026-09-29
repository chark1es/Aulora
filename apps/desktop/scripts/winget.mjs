import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = "https://github.com/chark1es/Aulora";
const schemaVersion = "1.12.0";
const packageId = "dev.spwnd.aulora";

export function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Use a stable version such as 1.0.0, without a v prefix or prerelease suffix.");
  }
  if (version.split(".").some((part) => Number(part) > 65535)) {
    throw new Error("Version components must fit Windows' 16-bit version fields.");
  }
  return version;
}

export function createManifests(version, filename, sha256) {
  validateVersion(version);
  if (filename !== `Aulora_${version}_x64-setup.exe`) {
    throw new Error("Use the x64 NSIS installer produced for this exact release version.");
  }
  if (!/^[A-F0-9]{64}$/.test(sha256)) throw new Error("A computed SHA-256 checksum is required.");
  const shared = { PackageIdentifier: packageId, PackageVersion: version };
  return {
    version: {
      ...shared,
      DefaultLocale: "en-US",
      ManifestType: "version",
      ManifestVersion: schemaVersion,
    },
    installer: {
      ...shared,
      InstallerType: "nullsoft",
      Scope: "user",
      InstallModes: ["interactive", "silent", "silentWithProgress"],
      InstallerSwitches: { Silent: "/S", SilentWithProgress: "/P" },
      UpgradeBehavior: "install",
      Protocols: ["aulora"],
      AppsAndFeaturesEntries: [
        { DisplayName: "Aulora", Publisher: "SPWND", DisplayVersion: version },
      ],
      Installers: [
        {
          Architecture: "x64",
          InstallerUrl: `${repository}/releases/download/v${version}/${filename}`,
          InstallerSha256: sha256,
        },
      ],
      ManifestType: "installer",
      ManifestVersion: schemaVersion,
    },
    defaultLocale: {
      ...shared,
      PackageLocale: "en-US",
      Publisher: "SPWND",
      PublisherUrl: repository,
      PackageName: "Aulora",
      PackageUrl: repository,
      License: "PolyForm Noncommercial 1.0.0; commercial license available separately",
      LicenseUrl: `${repository}/blob/v${version}/LICENSE`,
      ShortDescription:
        "Self-hosted team chat with native notifications and multi-workspace support.",
      ReleaseNotesUrl: `${repository}/releases/tag/v${version}`,
      ManifestType: "defaultLocale",
      ManifestVersion: schemaVersion,
    },
  };
}

// JSON-quoted strings avoid YAML treating versions, hashes or punctuation as other types.
export function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object"
          ? `${pad}-\n${toYaml(item, indent + 2)}`
          : `${pad}- ${JSON.stringify(item)}`,
      )
      .join("\n");
  }
  return Object.entries(value)
    .map(([key, item]) =>
      typeof item === "object"
        ? `${pad}${key}:\n${toYaml(item, indent + 2)}`
        : `${pad}${key}: ${JSON.stringify(item)}`,
    )
    .join("\n");
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

export async function generate({ installer, version, output, verifyDownload = false }) {
  const filename = basename(installer);
  const manifests = createManifests(version, filename, await hashFile(installer));
  const entry = manifests.installer.Installers[0];
  if (verifyDownload) {
    const response = await fetch(entry.InstallerUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Public installer download failed: HTTP ${response.status}.`);
    const hash = createHash("sha256");
    for await (const chunk of response.body) hash.update(chunk);
    if (hash.digest("hex").toUpperCase() !== entry.InstallerSha256) {
      throw new Error(
        "The public download differs from the local installer. Do not submit these manifests.",
      );
    }
  }
  const manifestDir = resolve(output, "manifests/d/dev/spwnd/aulora", version);
  await mkdir(manifestDir, { recursive: true });
  for (const [type, manifest] of Object.entries(manifests)) {
    const suffix =
      type === "version" ? "" : type === "defaultLocale" ? ".locale.en-US" : ".installer";
    const schema = `https://aka.ms/winget-manifest.${type}.${schemaVersion}.schema.json`;
    await writeFile(
      resolve(manifestDir, `${packageId}${suffix}.yaml`),
      `# yaml-language-server: $schema=${schema}\n${toYaml(manifest)}\n`,
    );
  }
  await writeFile(resolve(output, "SHA256SUMS"), `${entry.InstallerSha256}  ${filename}\n`);
  return manifestDir;
}

async function main() {
  const { values } = parseArgs({
    options: {
      installer: { type: "string" },
      version: { type: "string" },
      output: { type: "string" },
      "build-config": { type: "string" },
      "verify-download": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: bun run winget --installer <Aulora_VERSION_x64-setup.exe> [--version VERSION] [--output DIR] [--verify-download]",
    );
    console.log("Build override: bun run winget --version VERSION --build-config <config.json>");
    return;
  }
  const config = JSON.parse(
    await readFile(resolve(desktopDir, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const version = validateVersion(values.version ?? config.version);
  if (values["build-config"]) {
    if (values.installer || values["verify-download"])
      throw new Error("Generate the build override separately from manifests.");
    await writeFile(resolve(values["build-config"]), `${JSON.stringify({ version }, null, 2)}\n`);
    console.log(`Prepared Tauri build version ${version}.`);
    return;
  }
  if (!values.installer)
    throw new Error(
      "Provide a built installer with --installer. Placeholder hashes are not generated.",
    );
  const manifestDir = await generate({
    installer: resolve(values.installer),
    version,
    output: resolve(values.output ?? resolve(desktopDir, "dist/winget")),
    verifyDownload: values["verify-download"],
  });
  console.log(`Generated winget manifests: ${manifestDir}`);
  if (!values["verify-download"])
    console.log("Candidate only: verify the public download before submitting to winget.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
