/* eslint-disable security/detect-non-literal-fs-filename -- Paths are the repository checkout, build output or a temp fixture, joined from fixed names or this script's own arguments, never request data. */
/* eslint-disable xss/no-mixed-html -- Strings containing markup or generics are parsed as text; nothing is rendered or inserted into a page. */
// All paths are fixed names inside this test's mkdtemp fixture, which the test
// creates and removes.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetFrom,
  chunkKey,
  evaluateBundle,
  initialGraph,
  initialSeeds,
  staticDependencies,
} from "./bundle-budget.mjs";

const fixtures = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "aulora-bundle-budget-"));
  fixtures.push(root);
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    writeFileSync(join(dist, ...path.split("/")), contents);
  }
  return { dist, root };
}

const HTML = `<!doctype html>
<html><head>
<script src="/theme-boot.js"></script>
<script type="module" crossorigin src="/assets/index-aaaaaaaa.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-bbbbbbbb.js">
<link rel="stylesheet" crossorigin href="/assets/index-cccccccc.css">
</head><body></body></html>`;

function build(files) {
  return fixture({
    "index.html": HTML,
    "theme-boot.js": "document;",
    "assets/index-aaaaaaaa.js": files.entry,
    "assets/react-bbbbbbbb.js": files.react ?? "export const react = 1;",
    "assets/index-cccccccc.css": ".a{color:red}",
    ...files.extra,
  });
}

const lorem = (bytes) => "x".repeat(bytes);

test("budget keys ignore the content hash", () => {
  expect(chunkKey("assets/index-C5L5PBI_.js")).toBe("assets/index.js");
  expect(chunkKey("assets/livekit-client.esm-3aEWR7r6.js")).toBe("assets/livekit-client.esm.js");
  expect(chunkKey("assets/vision_wasm_internal-DInyi4w7.wasm")).toBe(
    "assets/vision_wasm_internal.wasm",
  );
  expect(chunkKey("assets/PictureInPictureButton-D_QVBd3i.js")).toBe(
    "assets/PictureInPictureButton.js",
  );
  expect(chunkKey("assets/theme-boot.js")).toBe("assets/theme-boot.js");
});

test("static dependencies skip dynamic imports and meta properties", () => {
  const code = [
    'import{n as e}from"./runtime.js";',
    'import"./side-effect.js";',
    'export{a as b}from"./re-export.js";',
    'const lazy = () => import("./lazy.js");',
    "const url = import.meta.url;",
  ].join("\n");
  expect(staticDependencies(code)).toEqual(["./runtime.js", "./side-effect.js", "./re-export.js"]);
});

test("initial graph follows modulepreload seeds and static imports only", () => {
  const { dist } = build({
    entry: 'import{a}from"./app-eeeeeeee.js";import("./livekit-client.esm-ffffffff.js");',
    extra: {
      "assets/app-eeeeeeee.js": 'import"./runtime-dddddddd.js";',
      "assets/runtime-dddddddd.js": "export const a = 1;",
      "assets/livekit-client.esm-ffffffff.js": "export const livekit = 1;",
    },
  });
  const graph = initialGraph(HTML, dist);
  expect(graph.files).toEqual([
    "assets/app-eeeeeeee.js",
    "assets/index-aaaaaaaa.js",
    "assets/index-cccccccc.css",
    "assets/react-bbbbbbbb.js",
    "assets/runtime-dddddddd.js",
    "theme-boot.js",
  ]);
  expect(graph.seeds).toContain("assets/react-bbbbbbbb.js");
  expect(graph.files).not.toContain("assets/livekit-client.esm-ffffffff.js");
});

test("index.html seeds include module scripts, preloads and stylesheets", () => {
  expect(initialSeeds(HTML)).toEqual([
    "theme-boot.js",
    "assets/index-aaaaaaaa.js",
    "assets/react-bbbbbbbb.js",
    "assets/index-cccccccc.css",
  ]);
});

function budgetFor(result) {
  return budgetFrom(result, { lazyOnly: [] });
}

test("a measured build fits the budget it generated", () => {
  const { dist } = build({ entry: 'import"./app-eeeeeeee.js";' });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const result = evaluateBundle({ distDir: dist, budget: budgetFor(measured) });
  expect(result.ok).toBe(true);
  expect(result.assets.size).toBe(3);
  expect(budgetFrom(result).chunks["assets/index.js"].raw).toBeGreaterThan(0);
});

test("--update headroom stays close to the measured size", () => {
  const { dist } = build({ entry: lorem(4000) });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = budgetFor(measured);
  const entry = measured.assets.get("assets/index.js");
  const ceiling = budget.chunks["assets/index.js"];
  expect(ceiling.raw).toBeGreaterThanOrEqual(entry.raw);
  expect(ceiling.raw).toBeLessThan(entry.raw * 1.2);
  expect(ceiling.gzip).toBeLessThan(entry.gzip * 1.2 + 64);
});

test("a chunk over its raw ceiling fails", () => {
  const { dist } = build({ entry: lorem(4096) });
  const result = evaluateBundle({
    distDir: dist,
    budget: { chunks: { "assets/index.js": { raw: 1024, gzip: 1_000_000 } } },
  });
  expect(result.ok).toBe(false);
  expect(result.failures.join("\n")).toContain("assets/index.js: raw");
});

test("a chunk over its gzip ceiling fails", () => {
  // Deterministic pseudo-random bytes (LCG) so gzip cannot shrink the chunk.
  let state = 0x2545f491;
  const noise = Array.from({ length: 4096 }, () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return String.fromCharCode(state >>> 24);
  });
  const { dist } = build({ entry: noise.join("") });
  const result = evaluateBundle({
    distDir: dist,
    budget: { chunks: { "assets/index.js": { raw: 1_000_000, gzip: 1024 } } },
  });
  expect(result.ok).toBe(false);
  expect(result.failures.join("\n")).toContain("assets/index.js: gzip");
});

test("a heavy dependency reachable from the entry chunk fails", () => {
  const { dist } = build({
    entry: 'import"./livekit-client.esm-ffffffff.js";',
    extra: { "assets/livekit-client.esm-ffffffff.js": "export const livekit = 1;" },
  });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = {
    ...budgetFor(measured),
    lazyOnly: [{ match: "livekit-client", reason: "lazy" }],
  };
  const result = evaluateBundle({ distDir: dist, budget });
  expect(result.ok).toBe(false);
  expect(result.failures.join("\n")).toContain("heavy dependency");
});

test("the same heavy dependency behind a dynamic import passes", () => {
  const { dist } = build({
    entry: 'const load = () => import("./livekit-client.esm-ffffffff.js");',
    extra: { "assets/livekit-client.esm-ffffffff.js": "export const livekit = 1;" },
  });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = {
    ...budgetFor(measured),
    lazyOnly: [{ match: "livekit-client", reason: "lazy" }],
  };
  const result = evaluateBundle({ distDir: dist, budget });
  expect(result.ok).toBe(true);
  expect(result.failures).toEqual([]);
});

test("a heavy dependency inlined into a renamed initial chunk fails by content", () => {
  const { dist } = build({
    entry: "var mediapipe = { version: 1 };",
    extra: { "assets/vision_bundle-ffffffff.js": "export const vision = 1;" },
  });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = {
    ...budgetFor(measured),
    lazyOnly: [{ match: "vision_bundle", contentMarkers: ["mediapipe"], reason: "lazy" }],
  };
  const result = evaluateBundle({ distDir: dist, budget });
  expect(result.ok).toBe(false);
  expect(result.failures.join("\n")).toContain('contains "mediapipe"');
});

test("a heavy dependency only in a lazy chunk passes the content check", () => {
  const { dist } = build({
    entry: 'const load = () => import("./vision_bundle-ffffffff.js");',
    extra: { "assets/vision_bundle-ffffffff.js": "var mediapipe = { version: 1 };" },
  });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = {
    ...budgetFor(measured),
    lazyOnly: [{ match: "vision_bundle", contentMarkers: ["mediapipe"], reason: "lazy" }],
  };
  const result = evaluateBundle({ distDir: dist, budget });
  expect(result.ok).toBe(true);
});

test("an unbudgeted chunk fails and a stale entry only warns", () => {
  const { dist } = build({ entry: "export const a = 1;" });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = budgetFor(measured);
  delete budget.chunks["assets/react.js"];
  budget.chunks["assets/removed-chunk.js"] = { raw: 1024, gzip: 1024 };
  const result = evaluateBundle({ distDir: dist, budget });
  expect(result.ok).toBe(false);
  expect(result.failures.join("\n")).toContain("assets/react.js: no budget entry");
  expect(result.warnings.join("\n")).toContain("assets/removed-chunk.js");
});

test("initial and total ceilings apply to their sums", () => {
  const { dist } = build({ entry: lorem(2048) });
  const measured = evaluateBundle({ distDir: dist, budget: { chunks: {} } });
  const budget = budgetFor(measured);
  const initial = evaluateBundle({
    distDir: dist,
    budget: { ...budget, initial: { raw: 1, gzip: 1 } },
  });
  expect(initial.failures.join("\n")).toContain("initial graph: raw");
  const total = evaluateBundle({
    distDir: dist,
    budget: { ...budget, initial: budget.initial, total: { raw: 1, gzip: 1 } },
  });
  expect(total.failures.join("\n")).toContain("all assets: raw");
});

test("a missing assets directory asks for a build", () => {
  const root = mkdtempSync(join(tmpdir(), "aulora-bundle-budget-empty-"));
  fixtures.push(root);
  expect(() => evaluateBundle({ distDir: root, budget: { chunks: {} } })).toThrow("bun run build");
});

test("font preloads count toward the initial graph; deferred preloads do not", () => {
  expect(
    initialSeeds(
      '<link rel="preload" as="font" href="/assets/inter.woff2"><link rel="preload" as="image" href="/image.png">',
    ),
  ).toEqual(["assets/inter.woff2"]);
});
