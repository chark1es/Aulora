// Builds the frontend the desktop shell embeds from the web build.
//
// `apps/web/dist` is the browser bundle; the desktop shell already ships the
// same legal notices as Tauri bundle resources (`bundle.resources.legal`), so
// embedding a second copy under `legal/` is pure duplication. This copies the
// web build to `apps/web/dist-desktop` without that duplicate and points
// `frontendDist` at it.
//
// The on-demand call-effect assets (MediaPipe/RNNoise WebAssembly and the
// selfie segmentation model) are deliberately KEPT: under the shell's
// no-remote-code CSP (`script-src 'self' 'wasm-unsafe-eval'`) they cannot be
// re-fetched from the workspace origin, so dropping them from the embed would
// silently disable background blur and noise suppression. Shrinking the embed
// further needs a deliberate local-asset/CSP decision first.
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
 * Only `legal/` is excluded: the Tauri bundle already ships the same notices
 * under `bundle.resources.legal` (see `src-tauri/tauri.conf.json`). The
 * call-effect assets are deliberately kept so background blur and noise
 * suppression keep working offline under the shell CSP.
 */
export function isExcludedDesktopAsset(relativePath) {
  const path = relativePath.split(sep).join("/");
  return path === "legal" || path.startsWith("legal/");
}

/** Total size of a directory tree in bytes. */
function directorySize(dir) {
  let total = 0;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed build output directory selected by this script.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed child entry of the build output tree.
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
