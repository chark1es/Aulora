import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function line() {
  console.log("-".repeat(72));
}

// Only these known specifiers may be imported, so the module id is never
// derived from arbitrary input.
function load(specifier) {
  switch (specifier) {
    case "blobatar":
      return import("blobatar");
    case "blobatar/uri":
      return import("blobatar/uri");
    case "blobatar/expression":
      return import("blobatar/expression");
    case "blobatar/internal":
      return import("blobatar/internal");
    case "blobatar/react":
      return import("blobatar/react");
    case "@blobatar/react":
      return import("@blobatar/react");
    default:
      throw new Error(`refusing to import unknown specifier: ${specifier}`);
  }
}

function printExports(spec, mod) {
  const keys = Object.keys(mod).sort();
  console.log(`\n>> ${spec}`);
  console.log("   exports:", keys.join(", "));
  for (const k of keys) {
    const v = Object.getOwnPropertyDescriptor(mod, k)?.value;
    const arity = typeof v === "function" ? ` (arity ${v.length})` : "";
    console.log(`     - ${k}: ${typeof v}${arity}`);
  }
}

async function dump(spec) {
  const mod = await load(spec);
  printExports(spec, mod);
  return mod;
}

const PACKAGE_NAMES = new Set([
  "blobatar",
  "@blobatar/react",
  "react",
  "react-dom",
  "react-test-renderer",
  "react-native-svg",
]);

function resolveEntry(name) {
  if (!PACKAGE_NAMES.has(name)) {
    throw new Error(`refusing to resolve unknown package: ${name}`);
  }
  switch (name) {
    case "blobatar":
      return require.resolve("blobatar");
    case "@blobatar/react":
      return require.resolve("@blobatar/react");
    case "react":
      return require.resolve("react");
    case "react-dom":
      return require.resolve("react-dom");
    case "react-test-renderer":
      return require.resolve("react-test-renderer");
    default:
      return require.resolve("react-native-svg");
  }
}

// Each known package is required with a literal and returned; the module id is
// consequently never derived from arbitrary input.
function requireManifest(name) {
  switch (name) {
    case "blobatar":
      return require("blobatar/package.json");
    case "@blobatar/react":
      return require("@blobatar/react/package.json");
    case "react":
      return require("react/package.json");
    case "react-dom":
      return require("react-dom/package.json");
    case "react-test-renderer":
      return require("react-test-renderer/package.json");
    case "react-native-svg":
      return require("react-native-svg/package.json");
    default:
      throw new Error(`refusing to read the manifest for unknown package: ${name}`);
  }
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
    const pkg = requireManifest(p);
    console.log(`  ${pkg.name.padEnd(26)} ${pkg.version.padEnd(10)} license=${pkg.license ?? "-"}`);
  } catch {
    console.log(`  ${p} -> not resolvable as ${p}/package.json (exports map)`);
    const entry = resolveEntry(p);
    console.log(`      entry: ${entry}`);
  }
}

line();
console.log("blobatar CORE (string API — the thing mobile consumes)");
line();
const core = await dump("blobatar");
console.log("\n>> blobatar/uri");
const uri = await load("blobatar/uri");
console.log("   exports:", Object.keys(uri).join(", "));
console.log("\n>> blobatar/expression");
const expr = await load("blobatar/expression");
console.log("   exports:", Object.keys(expr).join(", "));
console.log("\n>> blobatar/internal");
const internal = await load("blobatar/internal");
console.log("   exports:", Object.keys(internal).join(", "));

line();
console.log("REACT ADAPTER");
line();
await dump("@blobatar/react");
await dump("blobatar/react");

line();
console.log(`Core VERSION const = ${Object.getOwnPropertyDescriptor(core, "VERSION")?.value}`);
console.log(
  `blobatar("x") length=${core.blobatar("x").length}, starts with: ${core.blobatar("x").slice(0, 30)}`,
);
