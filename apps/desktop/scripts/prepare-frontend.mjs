// Builds the frontend the desktop shell embeds from the web build.
//
// `apps/web/dist` is the browser bundle; the desktop shell should not carry the
// on-demand call-effect assets (MediaPipe/RNNoise WebAssembly and the selfie
// segmentation model, ~13.4 MB) nor a second copy of the legal notices it also
// ships as Tauri bundle resources. This copies the web build to
// `apps/web/dist-desktop` without those files and points `frontendDist` at it.
//
//   node scripts/prepare-frontend.mjs
import { cpSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..", "..");
const sourceDir = resolve(repoRoot, "apps", "web", "dist");
const targetDir = resolve(repoRoot, "apps", "web", "dist-desktop");

/**
 * Whether a web build file is left out of the desktop embed. `relativePath` is
 * relative to the web `dist` root and uses POSIX separators.
 *
 * Excluded:
 * - `legal/` — the Tauri bundle already ships the same notices under
 *   `bundle.resources.legal` (see `src-tauri/tauri.conf.json`).
 * - the call-effect assets only loaded when background effects or noise
 *   suppression are enabled: `vision_wasm_*`, `vision_bundle-*`,
 *   `selfie_segmenter_*`, `rnnoise-*` and `rnnoise_*`.
 */
export function isExcludedDesktopAsset(relativePath) {
  const path = relativePath.split(sep).join("/");
  if (path === "legal" || path.startsWith("legal/")) {
    return true;
  }
  if (!path.startsWith("assets/")) {
    return false;
  }
  const name = path.slice("assets/".length);
  return (
    name.startsWith("vision_wasm_") ||
    name.startsWith("vision_bundle-") ||
    name.startsWith("selfie_segmenter_") ||
    name.startsWith("rnnoise-") ||
    name.startsWith("rnnoise_")
  );
}

/** Total size of a directory tree in bytes. */
function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(child) : statSync(child).size;
  }
  return total;
}

export function prepareFrontend({ source = sourceDir, target = targetDir } = {}) {
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, {
    recursive: true,
    filter: (src) => {
      const rel = relative(source, src);
      return rel === "" || !isExcludedDesktopAsset(rel);
    },
  });
  return { source, target, before: directorySize(source), after: directorySize(target) };
}

function main() {
  const { before, after, target } = prepareFrontend();
  const savedMb = ((before - after) / (1024 * 1024)).toFixed(1);
  process.stdout.write(
    `prepare-frontend: ${target} is ${(after / (1024 * 1024)).toFixed(1)} MB ` +
      `(${savedMb} MB smaller than the web build)\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `prepare-frontend: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
