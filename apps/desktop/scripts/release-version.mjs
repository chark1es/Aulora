import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Use a stable version such as 1.0.0, without a v prefix or prerelease suffix.");
  }
  if (version.split(".").some((part) => Number(part) > 65535)) {
    throw new Error("Version components must fit Windows' 16-bit version fields.");
  }
  return version;
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      output: { type: "string" },
    },
  });
  if (!values.output) throw new Error("Provide the Tauri version override path with --output.");
  const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(
    await readFile(resolve(desktopDir, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const version = validateVersion(values.version ?? config.version);
  await writeFile(resolve(values.output), `${JSON.stringify({ version }, null, 2)}\n`);
  console.log(`Prepared Tauri build version ${version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
