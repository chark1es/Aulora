import React from "react";
import { renderToString } from "react-dom/server";
import { blobatar } from "blobatar";
import { blobatarUri } from "blobatar/uri";
import { Blobatar } from "@blobatar/react";

const SEED = "aulora:user:8f3a1c"; // stable user id

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

console.log("== WEB RENDER (react-dom/server renderToString) ==\n");

// 1. Core string API: a full, self-contained <svg> string.
const svgString = blobatar(SEED, { size: 96 });
console.log(`[core] blobatar(seed) -> string of length ${svgString.length}`);
console.log(`[core] starts: ${svgString.slice(0, 80)}`);
console.log(`[core] ends:   ...${svgString.slice(-20)}`);
const isFullSvg =
  svgString.startsWith("<svg") && svgString.trimEnd().endsWith("</svg>");
const nodeCount = (svgString.match(/<(circle|path|g|rect|ellipse|polygon)/g) || [])
  .length;
console.log(`[core] full <svg> element: ${isFullSvg}, geometry nodes: ${nodeCount}`);
console.log(`[core] sha256(seed)=${hash(svgString)}`);

// 2. React component, static mode -> <img src="data:...">.
const staticHtml = renderToString(
  React.createElement(Blobatar, { name: SEED, size: 96 })
);
console.log(`\n[react] static renderToString length ${staticHtml.length}`);
console.log(`[react] starts: ${staticHtml.slice(0, 120)}`);
const isImg = staticHtml.startsWith("<img");
console.log(`[react] renders <img>: ${isImg}`);

// 3. React component, animated mode -> inline real SVG tree.
const animatedHtml = renderToString(
  React.createElement(Blobatar, { name: SEED, size: 96, animate: "always" })
);
console.log(`\n[react] animated renderToString length ${animatedHtml.length}`);
console.log(`[react] starts: ${animatedHtml.slice(0, 160)}`);
const hasSvg = animatedHtml.startsWith("<svg");
const animatedNodes = (animatedHtml.match(/<(circle|path|g)\b/g) || []).length;
console.log(`[react] inline <svg>: ${hasSvg}, geometry nodes: ${animatedNodes}`);

// 4. Data URI helper.
const du = blobatarUri(SEED);
console.log(`\n[uri] blobatarUri prefix: ${du.slice(0, 34)}`);
console.log(`[uri] length: ${du.length}`);

console.log("\n== ASSERTIONS ==");
const checks = [
  ["core returns full <svg>", isFullSvg],
  ["core svg nontrivial (>=3 nodes)", nodeCount >= 3],
  ["component static renders <img> data-uri", isImg && staticHtml.includes("data:image/svg+xml")],
  ["component animated renders inline <svg>", hasSvg],
  ["animated svg nontrivial (>=3 nodes)", animatedNodes >= 3],
  ["blobatarUri is an svg data uri", du.startsWith("data:image/svg+xml")],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  ok = ok && pass;
}
console.log(`\nWEB RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exitCode = ok ? 0 : 1;
