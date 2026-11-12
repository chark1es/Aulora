/* eslint-disable security/detect-non-literal-fs-filename -- Paths are the repository checkout, build output or a temp fixture, joined from fixed names or this script's own arguments, never request data. */
/* eslint-disable security/detect-object-injection -- Keys come from files in this checkout and fixed tables, and index loops are bounded by the array they walk; nothing here is request input. */
/* eslint-disable xss/no-mixed-html -- Strings containing markup or generics are parsed as text; nothing is rendered or inserted into a page. */
// Bundle size and lazy-loading guard for the web client.
//
// `apps/web/dist` is measured after `bun run build`; every emitted asset has a
// committed raw+gzip ceiling, the initial (entry + modulepreload) graph has its
// own ceilings, and the heavy on-demand libraries (LiveKit, MediaPipe, RNNoise)
// must not be reachable from the initial graph. Ceilings come from the measured
// baseline plus a fixed tolerance, so an update that grows a chunk beyond that
// has to either shrink it or explain the new number with `--update`.
//
//   node scripts/ci/bundle-budget.mjs            # check the current build
//   node scripts/ci/bundle-budget.mjs --update   # rewrite the budget file
//
// `--update` is a deliberate budget change: review the diff before committing
// it. See docs/performance.md for the workflow.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(scriptDir, "..", "..");
export const defaultDist = resolve(repoRoot, "apps", "web", "dist");
export const defaultBudget = resolve(scriptDir, "bundle-budget.json");

/** Headroom added to every measured size when `--update` writes the budget. */
export const DEFAULT_TOLERANCE = 0.1;

/** Ceilings are rounded up to this many bytes so the file stays readable. */
const ROUNDING = 64;

/**
 * Libraries that must stay behind a dynamic import, never in the initial
 * graph. `match` is checked against emitted chunk names (hash stripped) and
 * `contentMarkers` against the text of every initial-graph file, so a chunk
 * renamed or merged into the entry still fails the check.
 */
export const DEFAULT_LAZY_ONLY = [
  {
    match: "livekit-client",
    contentMarkers: ["livekit"],
    reason: "LiveKit is imported by the call screen only; it must stay a lazy chunk.",
  },
  {
    match: "vision_bundle",
    contentMarkers: ["mediapipe"],
    reason: "MediaPipe tasks-vision is imported only when a call enables background blur.",
  },
  {
    match: "vision_wasm_internal",
    contentMarkers: ["vision_wasm_internal"],
    reason: "MediaPipe WebAssembly loader is fetched on demand by the vision runtime.",
  },
  {
    match: "selfie_segmenter",
    contentMarkers: ["selfie_segmenter"],
    reason: "The selfie segmentation model is fetched when background blur starts.",
  },
  {
    match: "rnnoise",
    contentMarkers: ["rnnoise"],
    reason: "RNNoise noise suppression is loaded by the audio pipeline on demand.",
  },
];

/**
 * Stable budget key for an emitted asset: the Vite hash is stripped so a
 * content change keeps the same ceiling. `assets/index-C5L5PBI_.js` becomes
 * `assets/index.js`.
 */
export function chunkKey(assetPath) {
  const dir = posix.dirname(assetPath);
  const base = posix.basename(assetPath);
  const match = /^(.*)-([A-Za-z0-9_-]{8})(\.[A-Za-z0-9]+)$/.exec(base);
  const name = match?.[1] ? `${match[1]}${match[3]}` : base;
  return dir === "." ? name : `${dir}/${name}`;
}

function walkFiles(dir, prefix) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walkFiles(full, relativePath));
    else found.push({ full, relativePath });
  }
  return found;
}

/**
 * Every emitted asset with its raw and gzip size. `key` is the budget key,
 * `path` the dist-relative path. Assets that normalize to the same key (a
 * duplicate chunk name) are summed so one cannot hide under another's ceiling.
 */
export function measureAssets(distDir) {
  const assetsDir = join(distDir, "assets");
  if (!existsSync(assetsDir)) {
    throw new Error(`No assets directory at ${assetsDir}. Run \`bun run build\` first.`);
  }
  const measured = new Map();
  for (const file of walkFiles(assetsDir, "assets")) {
    const contents = readFileSync(file.full);
    const relativePath = file.relativePath.split(sep).join("/");
    const key = chunkKey(relativePath);
    const current = measured.get(key);
    const raw = contents.byteLength;
    const gzip = gzipSync(contents, { level: 9 }).byteLength;
    measured.set(key, {
      path: relativePath,
      raw: raw + (current?.raw ?? 0),
      gzip: gzip + (current?.gzip ?? 0),
      files: [...(current?.files ?? []), relativePath],
    });
  }
  return measured;
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

/**
 * Files the browser loads before any dynamic import: module scripts, preloaded
 * modules, and stylesheets referenced from `index.html`. Returned as paths
 * relative to `dist` (leading `/` removed).
 */
export function initialSeeds(html) {
  const seeds = [];
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const [tag, name] = match;
    const attributes = parseAttributes(tag);
    const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
    let reference;
    if (name.toLowerCase() === "script") reference = attributes.src;
    else if (
      rel.includes("modulepreload") ||
      rel.includes("stylesheet") ||
      (rel.includes("preload") && attributes.as?.toLowerCase() === "font")
    )
      reference = attributes.href;
    if (!reference?.startsWith("/")) continue;
    seeds.push(reference.replace(/^\/+/, ""));
  }
  return seeds;
}

/**
 * Static (not dynamic) module specifiers of a built chunk. Rolldown emits
 * `import{...}from"./x.js"`, `import"./x.js"` and `export{...}from"./x.js"`
 * plus `import("./x.js")` for lazy chunks; only the former are part of the
 * initial graph.
 */
export function staticDependencies(code) {
  const dependencies = [];
  for (const match of code.matchAll(/\b(import|export)\b/g)) {
    let index = match.index + match[0].length;
    while (index < code.length && /\s/.test(code[index])) index += 1;
    const next = code[index];
    // `import(...)` is a dynamic import; `import.meta` is not a dependency.
    if (next === "(" || next === ".") continue;
    // A side-effect import is a bare specifier right after the keyword.
    const bare = /^["']([^"']+)["']/.exec(code.slice(index, index + 512));
    if (bare) {
      dependencies.push(bare[1]);
      continue;
    }
    // Otherwise walk the import or export clause to its `from "..."`.
    let depth = 0;
    for (let cursor = index; cursor < Math.min(code.length, index + 2048); cursor += 1) {
      const character = code[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (depth === 0 && /[;=([]/.test(character)) break;
      else if (depth === 0 && character === "f" && code.startsWith("from", cursor)) {
        const specifier = /^from\s*["']([^"']+)["']/.exec(code.slice(cursor, cursor + 512));
        if (specifier) dependencies.push(specifier[1]);
        break;
      }
    }
  }
  return dependencies;
}

function resolveSpecifier(fromPath, specifier) {
  if (!specifier.startsWith(".")) return null;
  return posix.normalize(posix.join(posix.dirname(fromPath), specifier));
}

function readDistFile(distDir, relativePath) {
  const full = join(distDir, ...relativePath.split("/"));
  if (!existsSync(full)) return null;
  const contents = readFileSync(full);
  return { raw: contents.byteLength, gzip: gzipSync(contents, { level: 9 }).byteLength };
}

/**
 * The initial graph: `index.html` seeds plus every statically imported chunk,
 * transitively. Dynamic imports are deliberately not followed.
 */
export function initialGraph(html, distDir) {
  const seeds = initialSeeds(html);
  const visited = new Set();
  const missing = [];
  const queue = [...seeds];
  while (queue.length > 0) {
    const path = queue.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    const absolute = join(distDir, ...path.split("/"));
    if (!existsSync(absolute)) {
      missing.push(path);
      visited.delete(path);
      continue;
    }
    const code = readFileSync(absolute, "utf8");
    for (const specifier of staticDependencies(code)) {
      const resolved = resolveSpecifier(path, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return { files: [...visited].sort(), missing: missing.sort(), seeds };
}

function compare(measured, ceiling, label) {
  const failures = [];
  if (!ceiling) return [`${label}: no budget entry (run \`bun run perf:bundle -- --update\`)`];
  for (const dimension of ["raw", "gzip"]) {
    if (measured[dimension] > ceiling[dimension]) {
      failures.push(
        `${label}: ${dimension} ${measured[dimension]} B exceeds ${ceiling[dimension]} B ` +
          `(+${(((measured[dimension] - ceiling[dimension]) / ceiling[dimension]) * 100).toFixed(1)}%)`,
      );
    }
  }
  return failures;
}

/**
 * Evaluate a build against a budget. Never throws for budget breaches; the CLI
 * turns `failures` into the exit status.
 */
export function evaluateBundle({ distDir = defaultDist, budget }) {
  const assets = measureAssets(distDir);
  const htmlPath = join(distDir, "index.html");
  if (!existsSync(htmlPath)) throw new Error(`No index.html at ${htmlPath}.`);
  const html = readFileSync(htmlPath, "utf8");
  const graph = initialGraph(html, distDir);

  const failures = [];
  const warnings = [];
  const chunks = budget.chunks ?? {};

  let totalRaw = 0;
  let totalGzip = 0;
  for (const [key, measured] of assets) {
    totalRaw += measured.raw;
    totalGzip += measured.gzip;
    failures.push(...compare(measured, chunks[key], key));
  }
  for (const key of Object.keys(chunks)) {
    if (!assets.has(key)) warnings.push(`${key}: budget entry no longer produced by the build`);
  }

  let initialRaw = 0;
  let initialGzip = 0;
  const initialFiles = [];
  const lazyOnly = budget.lazyOnly ?? DEFAULT_LAZY_ONLY;
  for (const path of graph.files) {
    const size = readDistFile(distDir, path);
    if (!size) continue;
    initialRaw += size.raw;
    initialGzip += size.gzip;
    initialFiles.push(path);
    const lower = path.toLowerCase();
    const named = lazyOnly.find((entry) => lower.includes(entry.match.toLowerCase()));
    if (named) {
      failures.push(
        `${path}: heavy dependency "${named.match}" is in the initial chunk graph. ` +
          `Load it with a dynamic import instead. ${named.reason ?? ""}`.trim(),
      );
    }
    if (!/\.(?:js|mjs|css)$/.test(lower)) continue;
    const text = readFileSync(join(distDir, ...path.split("/")), "utf8").toLowerCase();
    for (const entry of lazyOnly) {
      for (const marker of entry.contentMarkers ?? []) {
        if (text.includes(marker.toLowerCase()) && named !== entry) {
          failures.push(
            `${path}: contains "${marker}", so "${entry.match}" is bundled into the initial ` +
              `graph. Load it with a dynamic import instead. ${entry.reason ?? ""}`.trim(),
          );
        }
      }
    }
  }

  failures.push(
    ...compare({ raw: initialRaw, gzip: initialGzip }, budget.initial, "initial graph"),
  );
  failures.push(...compare({ raw: totalRaw, gzip: totalGzip }, budget.total, "all assets"));

  for (const entry of lazyOnly) {
    if (![...assets.keys()].some((key) => key.toLowerCase().includes(entry.match.toLowerCase()))) {
      warnings.push(`lazyOnly "${entry.match}": no matching chunk in this build`);
    }
  }

  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    warnings,
    assets,
    initial: { files: initialFiles, seeds: graph.seeds, raw: initialRaw, gzip: initialGzip },
    total: { raw: totalRaw, gzip: totalGzip },
  };
}

function roundUp(bytes) {
  return Math.ceil((bytes * (1 + DEFAULT_TOLERANCE)) / ROUNDING) * ROUNDING;
}

/**
 * A fresh budget from the measured build: every chunk and total gets the
 * measured size plus `DEFAULT_TOLERANCE` headroom. `lazyOnly` is preserved from
 * the existing file so a rewrite cannot silently drop a guard.
 */
export function budgetFrom(result, existing = {}) {
  const chunks = {};
  for (const [key, measured] of [...result.assets].sort(([a], [b]) => a.localeCompare(b))) {
    chunks[key] = { raw: roundUp(measured.raw), gzip: roundUp(measured.gzip) };
  }
  return {
    version: 1,
    tolerance: DEFAULT_TOLERANCE,
    chunks,
    initial: { raw: roundUp(result.initial.raw), gzip: roundUp(result.initial.gzip) },
    total: { raw: roundUp(result.total.raw), gzip: roundUp(result.total.gzip) },
    lazyOnly: existing.lazyOnly ?? DEFAULT_LAZY_ONLY,
  };
}

function kilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function formatReport(result) {
  const lines = [
    `bundle-budget: ${result.assets.size} assets, ${result.total.raw} B raw ` +
      `(${kilobytes(result.total.raw)}) / ${result.total.gzip} B gzip`,
    `  initial graph: ${result.initial.files.length} files, ${result.initial.raw} B raw ` +
      `(${kilobytes(result.initial.raw)}) / ${result.initial.gzip} B gzip`,
  ];
  for (const warning of result.warnings) lines.push(`  warn: ${warning}`);
  for (const failure of result.failures) lines.push(`  FAIL: ${failure}`);
  lines.push(result.ok ? "bundle-budget: within budget" : "bundle-budget: over budget");
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const update = argv.includes("--update");
  const option = (name) => {
    const match = argv.find((argument) => argument.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : undefined;
  };
  const distDir = resolve(option("dist") ?? defaultDist);
  const budgetPath = resolve(option("budget") ?? defaultBudget);
  const existing = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, "utf8")) : {};
  if (!update && existing.chunks === undefined) {
    throw new Error(
      `No budget file at ${budgetPath}. Run \`bun run perf:bundle -- --update\` to create it.`,
    );
  }
  const result = evaluateBundle({ distDir, budget: existing });
  if (update) {
    const budget = budgetFrom(result, existing);
    writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
    process.stdout.write(`bundle-budget: wrote ${budgetPath}\n${formatReport(result)}`);
    return 0;
  }
  process.stdout.write(formatReport(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `bundle-budget: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
