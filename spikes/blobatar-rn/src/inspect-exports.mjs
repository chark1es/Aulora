import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function line() {
  console.log("-".repeat(72));
}

async function dump(spec, loader) {
  const mod = await import(spec);
  const keys = Object.keys(mod).sort();
  console.log(`\n>> ${spec}`);
  console.log("   exports:", keys.join(", "));
  for (const k of keys) {
    const v = mod[k];
    console.log(
      `     - ${k}: ${typeof v}${typeof v === "function" ? ` (arity ${v.length})` : ""}`
    );
  }
  return mod;
}

line();
console.log("INSTALLED PACKAGE VERSIONS (from package.json on disk)");
line();
for (const p of [
  "blobatar",
  "@blobatar/react",
  "react",
  "react-dom",
  "react-test-renderer",
  "react-native-svg",
]) {
  try {
    const pkg = require(`${p}/package.json`);
    console.log(
      `  ${pkg.name.padEnd(26)} ${pkg.version.padEnd(10)} license=${pkg.license ?? "-"}`
    );
  } catch (e) {
    console.log(`  ${p} -> not resolvable as ${p}/package.json (exports map)`);
    const entry = require.resolve(p);
    console.log(`      entry: ${entry}`);
  }
}

line();
console.log("blobatar CORE (string API — the thing mobile consumes)");
line();
const core = await dump("blobatar");
console.log("\n>> blobatar/uri");
const uri = await import("blobatar/uri");
console.log("   exports:", Object.keys(uri).join(", "));
console.log("\n>> blobatar/expression");
const expr = await import("blobatar/expression");
console.log("   exports:", Object.keys(expr).join(", "));
console.log("\n>> blobatar/internal");
const internal = await import("blobatar/internal");
console.log("   exports:", Object.keys(internal).join(", "));

line();
console.log("REACT ADAPTER");
line();
await dump("@blobatar/react");
await dump("blobatar/react");

line();
console.log(`Core VERSION const = ${core.VERSION}`);
console.log(
  `blobatar("x") length=${core.blobatar("x").length}, starts with: ${core.blobatar("x").slice(0, 30)}`
);
