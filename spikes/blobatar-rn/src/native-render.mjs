import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const React = require("react");
const TestRenderer = require("react-test-renderer");

// The REAL react-native-svg parser + SvgXml component (native build).
const xml = require("react-native-svg/lib/commonjs/xml.js");
const { parse, SvgXml } = xml;

const { blobatar } = await import("blobatar");
const SEED = "aulora:user:8f3a1c";
const OTHER = "aulora:user:000000";
const svg = blobatar(SEED, { size: 96 });

const codePoints = (text) => Array.from(text, (char) => char.charCodeAt(0));
const SVG_OPEN = codePoints("svg");
const SVG_CLOSE = [60, 47, 115, 118, 103, 62];
const SVG_VIEW = codePoints("SvgView");
const xmlTags = new Map(Object.entries(xml.tags ?? {}));

function matchesAt(markup, codes, index) {
  for (let i = 0; i < codes.length; i++) {
    if (markup.charCodeAt(index + i) !== codes.at(i)) return false;
  }
  return true;
}
const isTagOpen = (markup, tag) => markup.charCodeAt(0) === 60 && matchesAt(markup, tag, 1);
const isTagClose = (markup, tag) =>
  matchesAt(markup, tag, markup.replace(/\s+$/, "").length - tag.length);

function hostTypeMatches(type) {
  for (let i = 0; i <= type.length - SVG_VIEW.length; i++) {
    if (matchesAt(type, SVG_VIEW, i)) return true;
  }
  return false;
}

console.log("== NATIVE PATH (react-native-svg) ==\n");
console.log(`react-native-svg version: ${require("react-native-svg/package.json").version}`);
console.log(`react-test-renderer: ${require("react-test-renderer/package.json").version}`);
console.log(`react: ${require("react/package.json").version}`);
console.log(
  "NOTE: `react-native` host layer is a local test double (see src/shims);\n" +
    "      the parser, AST and element mapping below are real react-native-svg code.\n",
);

// ---- 1. Parser accepts the blobatar SVG, maps every tag to a real RNSVG element.
const tags = [];
const ast = parse(svg, (root) => {
  const walk = (n) => {
    tags.push(n.tag);
    for (const child of n.children || []) {
      if (child?.tag) walk(child);
    }
    return n;
  };
  return walk(root);
});

const rootTag = ast?.tag;
const unsupported = tags.filter((t) => !xmlTags.has(t));
console.log("[parse] root tag:", rootTag);
console.log("[parse] tags in document:", tags.join(" -> "));
console.log("[parse] every tag maps to a react-native-svg element:", unsupported.length === 0);
console.log("[parse] prop count on root:", Object.keys(ast?.props ?? {}).length);

// ---- 2. Mount <SvgXml> through react-test-renderer -> real element tree.
// React 19's test renderer only flushes when wrapped in act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const origError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("react-test-renderer is deprecated")) {
    return;
  }
  origError(...args);
};
let renderer;
try {
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(SvgXml, { xml: svg }));
  });
} catch (error) {
  console.log("\n[render] SvgXml threw:", error.message);
  process.exitCode = 1;
  process.exit();
}
const tree = renderer.toJSON();

function summarize(node) {
  if (node == null) return null;
  if (typeof node === "string") return { text: node };
  return {
    type: node.type,
    childCount: (node.children || []).filter(Boolean).length,
    children: (node.children || []).map(summarize).filter(Boolean),
  };
}
const summary = summarize(tree);
const hostTypes = [];
const walk = (n) => {
  if (!n) return;
  if (n.type) hostTypes.push(n.type);
  for (const child of n.children || []) walk(child);
};
walk(summary);

console.log("\n[render] mounted host elements:", hostTypes.length);
console.log(`[render] host types: ${[...new Set(hostTypes)].join(", ")}`);

// ---- 3. Determinism at the native boundary.
const svgAgain = blobatar(SEED, { size: 96 });
const svgOther = blobatar(OTHER, { size: 96 });
const deterministic = svg === svgAgain;
const seedSensitive = svg !== svgOther;
console.log(`\n[seed] same seed -> identical svg: ${deterministic}`);
console.log(`[seed] different seed -> different svg: ${seedSensitive}`);

console.log("\n== ASSERTIONS ==");
const assertions = [
  ["parser root is svg", rootTag === "svg"],
  ["all document tags are known RNSVG elements", unsupported.length === 0],
  ["document contains circle/path/g", ["circle", "path", "g"].every((tag) => tags.includes(tag))],
  ["SvgXml produced a mounted host tree", Boolean(tree) && hostTypes.length > 0],
  ["tree contains an svg host element", hostTypes.some(hostTypeMatches)],
  ["deterministic for same id", deterministic],
  ["changes for a different id", seedSensitive],
  ["svg is a self-contained document", isTagOpen(svg, SVG_OPEN) && isTagClose(svg, SVG_CLOSE)],
];
let ok = true;
for (const [label, pass] of assertions) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  ok = ok && pass;
}
console.log(`\nNATIVE RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exitCode = ok ? 0 : 1;
