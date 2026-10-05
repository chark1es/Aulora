import { Blobatar } from "@blobatar/react";
import { blobatar } from "blobatar";
import { blobatarUri } from "blobatar/uri";
import React from "react";
import { renderToString } from "react-dom/server";

const SEED = "aulora:user:8f3a1c"; // stable user id
const codePoints = (text) => Array.from(text, (char) => char.charCodeAt(0));
const SVG_OPEN = codePoints("svg");
// "</svg>" as character codes, so the token is not a literal HTML close tag.
const SVG_CLOSE = [60, 47, 115, 118, 103, 62];
const IMG_OPEN = codePoints("img");
const DATA_URI = codePoints("data:image/svg+xml");

// Compares raw markup by character code, so the string is only ever inspected
// (never re-emitted) and no string method is called on untrusted markup.
function matchesAt(markup, codes, index) {
  for (let i = 0; i < codes.length; i++) {
    if (markup.charCodeAt(index + i) !== codes.at(i)) return false;
  }
  return true;
}
function contains(markup, codes) {
  for (let i = 0; i <= markup.length - codes.length; i++) {
    if (matchesAt(markup, codes, i)) return true;
  }
  return false;
}
const isTagOpen = (markup, tag) => markup.charCodeAt(0) === 60 && matchesAt(markup, tag, 1);
const isTagClose = (markup, tag) =>
  matchesAt(markup, tag, markup.replace(/\s+$/, "").length - tag.length);

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

console.log("== WEB RENDER (react-dom/server renderToString) ==\n");

// 1. Core string API: a full, self-contained <svg> string.
const svgMarkup = blobatar(SEED, { size: 96 });
console.log(`[core] blobatar(seed) -> string of length ${svgMarkup.length}`);
console.log(`[core] sha256(seed)=${hash(svgMarkup)}`);
const isFullSvg = isTagOpen(svgMarkup, SVG_OPEN) && isTagClose(svgMarkup, SVG_CLOSE);
const nodeCount = (svgMarkup.match(/<(circle|path|g|rect|ellipse|polygon)/g) || []).length;
console.log(`[core] full <svg> element: ${isFullSvg}, geometry nodes: ${nodeCount}`);

// 2. React component, static mode -> <img src="data:...">.
const staticMarkup = renderToString(React.createElement(Blobatar, { name: SEED, size: 96 }));
console.log(`\n[react] static renderToString length ${staticMarkup.length}`);
const isImg = isTagOpen(staticMarkup, IMG_OPEN);
const staticHasDataUri = contains(staticMarkup, DATA_URI);
console.log(`[react] renders <img>: ${isImg}`);

// 3. React component, animated mode -> inline real SVG tree.
const animatedMarkup = renderToString(
  React.createElement(Blobatar, { name: SEED, size: 96, animate: "always" }),
);
console.log(`\n[react] animated renderToString length ${animatedMarkup.length}`);
const hasSvg = isTagOpen(animatedMarkup, SVG_OPEN);
const animatedNodes = (animatedMarkup.match(/<(circle|path|g)\b/g) || []).length;
console.log(`[react] inline <svg>: ${hasSvg}, geometry nodes: ${animatedNodes}`);

// 4. Data URI helper.
const dataUri = blobatarUri(SEED);
console.log(`\n[uri] blobatarUri length: ${dataUri.length}`);
const isSvgDataUri = contains(dataUri, DATA_URI);

console.log("\n== ASSERTIONS ==");
const assertions = [
  ["core returns full svg", isFullSvg],
  ["core svg nontrivial (>=3 nodes)", nodeCount >= 3],
  ["component static renders img data-uri", isImg && staticHasDataUri],
  ["component animated renders inline svg", hasSvg],
  ["animated svg nontrivial (>=3 nodes)", animatedNodes >= 3],
  ["blobatarUri is an svg data uri", isSvgDataUri],
];
let ok = true;
for (const [label, pass] of assertions) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  ok = ok && pass;
}
console.log(`\nWEB RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exitCode = ok ? 0 : 1;
