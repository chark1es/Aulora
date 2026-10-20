// Reads the server's environment catalog straight from its TypeScript sources in
// `packages/convex/convex/lib`. The docs build is plain Node, and the catalog
// files import each other with extensionless specifiers that Node's type
// stripping cannot resolve, so this module parses the small, regular literal
// shapes the catalog exports instead of executing them. The shape is fixed and
// unit-tested against the source.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY_SPLIT = /\n {2}\{\n/;
const FIELD = /^ {4}([A-Za-z]+):\s*(.*)$/;
const GROUP = /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g;

function unquote(literal) {
  if (literal.startsWith('"')) return JSON.parse(literal);
  return literal.slice(1, -1).replace(/\\([\\'])/g, "$1");
}

function parseValue(name, raw) {
  if (name === "secret" || name === "overridable") return raw === "true";
  if (name === "enumValues") {
    return [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  }
  if (name === "min" || name === "max") {
    return /^-?\d+$/.test(raw) ? Number(raw) : raw;
  }
  if (raw.startsWith('"') || raw.startsWith("'")) return unquote(raw);
  return raw;
}

function parseEntry(chunk) {
  const fields = new Map();
  const lines = chunk.split("\n");
  // A value may sit on the line after its key; `skipNext` consumes that line.
  let skipNext = false;
  for (const [index, line] of lines.entries()) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const match = FIELD.exec(line);
    if (match === null) continue;
    let raw = match[2].trim();
    if (raw === "") {
      raw = (lines.at(index + 1) ?? "").trim();
      skipNext = true;
    }
    fields.set(match[1], parseValue(match[1], raw.replace(/,\s*$/, "")));
  }
  return Object.fromEntries(fields);
}

/** Parses the `readonly EnvVarDefinition[]` arrays a catalog module exports. */
export function parseCatalogEntries(source) {
  return source
    .split(ENTRY_SPLIT)
    .slice(1)
    .map((chunk) => parseEntry(chunk.slice(0, chunk.indexOf("\n  }"))));
}

/** Parses the ordered `{ id, label }` group list from `envCatalog.ts`. */
export function parseGroups(source) {
  const start = source.indexOf("ENV_VAR_GROUPS");
  const body = source.slice(start, source.indexOf("];", start));
  return [...body.matchAll(GROUP)].map((match) => ({ id: match[1], label: match[2] }));
}

/** Parses a literal `readonly string[]` export, such as `OIDC_REQUIRED_ENV_KEYS`. */
export function parseStringArray(source, name) {
  const start = source.indexOf(`export const ${name}`);
  const equals = source.indexOf("=", start);
  const open = source.indexOf("[", equals);
  const close = source.indexOf("]", open);
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * Reads every catalog entry, in display order, from the repository sources.
 * Returns the combined `variables`, the ordered `groups`, and the OIDC keys
 * that must be configured together.
 */
export function readEnvCatalog(root) {
  const libDir = join(root, "packages", "convex", "convex", "lib");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `name` is one of four fixed catalog file names below
  const read = (name) => readFileSync(join(libDir, name), "utf8");
  const main = read("envCatalog.ts");
  return {
    groups: parseGroups(main),
    required: parseStringArray(main, "OIDC_REQUIRED_ENV_KEYS"),
    variables: [
      ...parseCatalogEntries(read("envCatalogAuth.ts")),
      ...parseCatalogEntries(read("envCatalogInstance.ts")),
      ...parseCatalogEntries(read("envCatalogDeployment.ts")),
    ],
  };
}
