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

console.log("== NATIVE PATH (react-native-svg) ==\n");
console.log(`react-native-svg version: ${require("react-native-svg/package.json").version}`);
console.log(`react-test-renderer: ${require("react-test-renderer/package.json").version}`);
console.log(`react: ${require("react/package.json").version}`);
console.log(
  "NOTE: `react-native` host layer is a local test double (see src/shims);\n" +
    "      the parser, AST and element mapping below are real react-native-svg code.\n"
);

// ---- 1. Parser accepts the blobatar SVG, maps every tag to a real RNSVG element.
const tags = [];
const ast = parse(svg, (root) => {
  const walk = (n) => {
    tags.push(n.tag);
    (n.children || []).forEach((c) => c && c.tag && walk(c));
    return n;
  };
  return walk(root);
});

const rootTag = ast && ast.tag;
const unsupported = tags.filter((t) => !xml.tags[t]);
console.log("[parse] root tag:", rootTag);
console.log("[parse] tags in document:", tags.join(" -> "));
console.log(
  "[parse] every tag maps to a react-native-svg element:",
  unsupported.length === 0
);
console.log("[parse] props on <svg>:", JSON.stringify(ast.props));

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
} catch (e) {
  console.log("\n[render] SvgXml threw:", e.message);
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
  (n.children || []).forEach(walk);
};
walk(summary);

console.log("\n[render] react-test-renderer JSON tree:");
console.log(JSON.stringify(summary, null, 2));
console.log(`\n[render] host elements mounted: ${hostTypes.length}`);
console.log(`[render] host types: ${[...new Set(hostTypes)].join(", ")}`);

// ---- 3. Determinism at the native boundary.
const svgAgain = blobatar(SEED, { size: 96 });
const svgOther = blobatar(OTHER, { size: 96 });
const deterministic = svg === svgAgain;
const seedSensitive = svg !== svgOther;
console.log(`\n[seed] same seed -> identical svg: ${deterministic}`);
console.log(`[seed] different seed -> different svg: ${seedSensitive}`);

console.log("\n== ASSERTIONS ==");
const checks = [
  ["parser root is <svg>", rootTag === "svg"],
  ["all document tags are known RNSVG elements", unsupported.length === 0],
  ["document contains circle/path/g", ["circle", "path", "g"].every((t) => tags.includes(t))],
  ["SvgXml produced a mounted host tree", !!tree && hostTypes.length > 0],
  ["tree contains an svg host element", hostTypes.some((t) => /SvgView/i.test(t))],
  ["deterministic for same id", deterministic],
  ["changes for a different id", seedSensitive],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  ok = ok && pass;
}
console.log(`\nNATIVE RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exitCode = ok ? 0 : 1;
