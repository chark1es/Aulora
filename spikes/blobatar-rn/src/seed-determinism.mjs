import crypto from "node:crypto";
import { Blobatar } from "@blobatar/react";
import { blobatar, normalizeSeed } from "blobatar";
import { blobatarUri } from "blobatar/uri";
import React from "react";
import { renderToString } from "react-dom/server";

const codePoints = (text) => Array.from(text, (char) => char.charCodeAt(0));
const SVG_OPEN = codePoints("svg");
const SVG_CLOSE = [60, 47, 115, 118, 103, 62];
const DATA_URI = codePoints("data:image/svg+xml");

function matchesAt(text, codes, index) {
  for (let i = 0; i < codes.length; i++) {
    if (text.charCodeAt(index + i) !== codes.at(i)) return false;
  }
  return true;
}
const isTagOpen = (markup, tag) => markup.charCodeAt(0) === 60 && matchesAt(markup, tag, 1);
const isTagClose = (markup, tag) =>
  matchesAt(markup, tag, markup.replace(/\s+$/, "").length - tag.length);
const contains = (text, codes) => {
  for (let i = 0; i <= text.length - codes.length; i++) {
    if (matchesAt(text, codes, i)) return true;
  }
  return false;
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

const ids = [
  "aulora:user:8f3a1c",
  "aulora:user:8f3a1d",
  "aulora:user:000000",
  "alice@example.com",
  "bob@example.com",
];

console.log("== SEEDING / DETERMINISM ==\n");
console.log(
  "normalizeSeed('  Alice@Example.COM ') =",
  JSON.stringify(normalizeSeed("  Alice@Example.COM ")),
);

console.log("\n-- core blobatar(name) --");
const core = ids.map((id) => {
  const a = blobatar(id, { size: 96 });
  const b = blobatar(id, { size: 96 });
  console.log(`  ${id.padEnd(24)} sha=${sha(a)} repeatable=${a === b} len=${a.length}`);
  return a;
});
const coreUnique = new Set(core).size;
console.log(`  distinct outputs: ${coreUnique}/${ids.length}`);

console.log("\n-- @blobatar/react renderToString(static) --");
const web = ids.map((id) => renderToString(React.createElement(Blobatar, { name: id, size: 96 })));
web.forEach((markup, i) => {
  console.log(`  ${ids.at(i).padEnd(24)} sha=${sha(markup)}`);
});
const webUnique = new Set(web).size;
console.log(`  distinct outputs: ${webUnique}/${ids.length}`);

console.log("\n-- @blobatar/react renderToString(animate='always') --");
const anim = ids.map((id) =>
  renderToString(React.createElement(Blobatar, { name: id, size: 96, animate: "always" })),
);
const animUnique = new Set(anim).size;
console.log(`  distinct outputs: ${animUnique}/${ids.length}`);

console.log("\n-- blobatarUri(name) --");
const uris = ids.map((id) => blobatarUri(id));
const uriUnique = new Set(uris).size;
console.log(`  distinct outputs: ${uriUnique}/${ids.length}`);

console.log("\n-- normalize option interplay --");
const normDefault = blobatar("Alice@Example.COM", { size: 96 });
const normOff = blobatar("Alice@Example.COM", { size: 96, normalize: false });
const lower = blobatar("alice@example.com", { size: 96 });
console.log(
  `  default normalize("Alice@Example.COM") == ("alice@example.com"): ${normDefault === lower}`,
);
console.log(`  normalize:false differs: ${normOff !== lower}`);

console.log("\n== ASSERTIONS ==");
const assertions = [
  ["core deterministic per id", core.every((s, i) => s === blobatar(ids.at(i), { size: 96 }))],
  ["core distinct across 5 ids", coreUnique === ids.length],
  ["web component renders svg per id", web.every((m) => isTagOpen(m, SVG_OPEN))],
  ["web component distinct across 5 ids", webUnique === ids.length],
  ["animated component distinct across 5 ids", animUnique === ids.length],
  ["uri distinct across 5 ids", uriUnique === ids.length],
  ["uri contains an svg data uri", contains(uris[0], DATA_URI)],
  [
    "svg documents are self-contained",
    isTagOpen(core[0], SVG_OPEN) && isTagClose(core[0], SVG_CLOSE),
  ],
  ["normalize lowercases by default", normDefault === lower],
  ["normalize:false keeps case", normOff !== lower],
];
let ok = true;
for (const [label, pass] of assertions) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  ok = ok && pass;
}
console.log(`\nSEED RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exitCode = ok ? 0 : 1;
