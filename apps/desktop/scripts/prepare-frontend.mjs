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
// The embed also has a committed size ceiling (`frontend-budget.json`) so a
// feature that ships every asset eagerly fails the desktop build instead of
// silently growing the installer. The ceiling is deliberately close to the
// measured size: raise it with `--update-budget` and review the diff.
//
//   node scripts/prepare-frontend.mjs                   # copy and check the ceiling
//   node scripts/prepare-frontend.mjs --update-budget   # rewrite the ceiling
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..", "..");
const sourceDir = resolve(repoRoot, "apps", "web", "dist");
const targetDir = resolve(repoRoot, "apps", "web", "dist-desktop");
export const budgetPath = resolve(scriptDir, "frontend-budget.json");

/** Headroom added to the measured embed when `--update-budget` writes it. */
export const DEFAULT_TOLERANCE = 0.1;

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

/**
 * Fail when the prepared embed exceeds its committed ceiling. `bytes` is the
 * total size of `apps/web/dist-desktop`, the directory Tauri ships.
 */
export function assertFrontendBudget({ bytes, budget }) {
  if (!budget || typeof budget.maxBytes !== "number") {
    throw new Error(
      `No embed budget at ${budgetPath}. Run \`node scripts/prepare-frontend.mjs --update-budget\`.`,
    );
  }
  if (bytes > budget.maxBytes) {
    const overMb = ((bytes - budget.maxBytes) / (1024 * 1024)).toFixed(2);
    throw new Error(
      `embedded frontend is ${(bytes / (1024 * 1024)).toFixed(1)} MB, over the ` +
        `${(budget.maxBytes / (1024 * 1024)).toFixed(1)} MB ceiling by ${overMb} MB. ` +
        "Load new bulk assets on demand or run `node scripts/prepare-frontend.mjs --update-budget` " +
        "with a reviewed reason.",
    );
  }
  return { bytes, remaining: budget.maxBytes - bytes };
}

/** A ceiling for the measured embed: the size plus `tolerance` headroom. */
export function budgetFromBytes(bytes, tolerance = DEFAULT_TOLERANCE) {
  return { version: 1, tolerance, maxBytes: Math.ceil((bytes * (1 + tolerance)) / 1024) * 1024 };
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

function main(argv = process.argv.slice(2)) {
  const update = argv.includes("--update-budget");
  const { before, after, target } = prepareFrontend();
  const savedMb = ((before - after) / (1024 * 1024)).toFixed(1);
  if (update) {
    const budget = budgetFromBytes(after);
    writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
    process.stdout.write(`prepare-frontend: wrote ${budgetPath} (${budget.maxBytes} B)\n`);
  } else {
    const budget = existsSync(budgetPath)
      ? JSON.parse(readFileSync(budgetPath, "utf8"))
      : undefined;
    assertFrontendBudget({ bytes: after, budget });
  }
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
