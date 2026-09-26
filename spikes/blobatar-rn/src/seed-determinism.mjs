import crypto from "node:crypto";
import React from "react";
import { renderToString } from "react-dom/server";
import { blobatar, normalizeSeed } from "blobatar";
import { blobatarUri } from "blobatar/uri";
import { Blobatar } from "@blobatar/react";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

const ids = [
  "aulora:user:8f3a1c",
  "aulora:user:8f3a1d",
  "aulora:user:000000",
  "alice@example.com",
  "bob@example.com",
];

console.log("== SEEDING / DETERMINISM ==\n");
console.log("normalizeSeed('  Alice@Example.COM ') =", JSON.stringify(normalizeSeed("  Alice@Example.COM ")));

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
web.forEach((html, i) => console.log(`  ${ids[i].padEnd(24)} sha=${sha(html)}`));
const webUnique = new Set(web).size;
console.log(`  distinct outputs: ${webUnique}/${ids.length}`);

console.log("\n-- @blobatar/react renderToString(animate='always') --");
const anim = ids.map((id) =>
  renderToString(React.createElement(Blobatar, { name: id, size: 96, animate: "always" }))
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
console.log(`  default normalize("Alice@Example.COM") == ("alice@example.com"): ${normDefault === lower}`);
console.log(`  normalize:false differs: ${normOff !== lower}`);

console.log("\n== ASSERTIONS ==");
const checks = [
  ["core deterministic per id", core.every((s, i) => s === blobatar(ids[i], { size: 96 }))],
  ["core distinct across 5 ids", coreUnique === ids.length],
  ["web component distinct across 5 ids", webUnique === ids.length],
  ["animated component distinct across 5 ids", animUnique === ids.length],
  ["uri distinct across 5 ids", uriUnique === ids.length],
  ["normalize lowercases by default", normDefault === lower],
  ["normalize:false keeps case", normOff !== lower],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  ok = ok && pass;
}
console.log(`\nSEED RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exitCode = ok ? 0 : 1;
