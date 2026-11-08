// Schema compatibility snapshot for release checks.
//
// This is intentionally a heuristic, not a Convex schema parser: it records
// each table's top-level required/optional fields and fails a release when a
// field becomes required, a required field is added, or a table/field is
// removed. A change that is safe because a backfill exists opts out with a
// marker comment in `schema.ts`:
//
//   // @compat-allow-tighten: server.exampleField -- backfilled by migration X
//
// Run `node scripts/ci/check-schema-compat.mjs --update` after an intentional
// change and commit the snapshot with it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const SCHEMA_PATH = "packages/convex/convex/schema.ts";
export const SNAPSHOT_PATH = "scripts/ci/schema-snapshot.json";

const TABLE_START = /^ {2}([A-Za-z0-9_]+): defineTable\(\{$/;
const TABLE_END = /^ {2}\}\)/;
const FIELD = /^ {4}([A-Za-z0-9_]+):\s*(.*)$/;
const ALLOW_MARKER = /@compat-allow-tighten:\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;

/**
 * Extracts `{ tables: { name: { fields: { field: "required" | "optional" } } } }`
 * from the schema source. Nested validators are not inspected; the fixture
 * test in `packages/convex/test/compat` covers real document shapes.
 */
export function snapshotSchema(source) {
  const tables = {};
  let current = null;
  for (const line of source.split("\n")) {
    if (current === null) {
      const start = TABLE_START.exec(line);
      if (start !== null) {
        current = { fields: {} };
        tables[start[1]] = current;
      }
      continue;
    }
    if (TABLE_END.test(line)) {
      current = null;
      continue;
    }
    const field = FIELD.exec(line);
    if (field !== null) {
      current.fields[field[1]] = field[2].startsWith("v.optional(") ? "optional" : "required";
    }
  }
  return { tables };
}

/** Marker keys like `server.exampleField` that allow a tightening. */
export function allowedTightenings(source) {
  const allowed = new Set();
  for (const match of source.matchAll(ALLOW_MARKER)) {
    allowed.add(`${match[1]}.${match[2]}`);
  }
  return allowed;
}

/**
 * Returns human-readable violations when the current schema tightens a field
 * recorded in the previous snapshot without a marker.
 */
export function schemaViolations(previous, current, allowed = new Set()) {
  const violations = [];
  const permits = (table, field) => allowed.has(`${table}.${field}`);
  for (const [table, snapshot] of Object.entries(previous.tables ?? {})) {
    const now = current.tables?.[table];
    if (now === undefined) {
      violations.push(`${table}: table was removed without a compatibility marker`);
      continue;
    }
    for (const [field, requirement] of Object.entries(snapshot.fields ?? {})) {
      const next = now.fields[field];
      if (next === undefined) {
        if (!permits(table, field)) {
          violations.push(`${table}.${field}: field was removed without a compatibility marker`);
        }
        continue;
      }
      if (requirement === "optional" && next === "required" && !permits(table, field)) {
        violations.push(
          `${table}.${field}: became required without a @compat-allow-tighten marker and backfill`,
        );
      }
    }
    for (const [field, requirement] of Object.entries(now.fields)) {
      if (snapshot.fields?.[field] === undefined && requirement === "required") {
        if (!permits(table, field)) {
          violations.push(
            `${table}.${field}: new required field needs a @compat-allow-tighten marker and backfill`,
          );
        }
      }
    }
  }
  return violations;
}

export function readSchema(rootDir = root) {
  return readFileSync(resolve(rootDir, SCHEMA_PATH), "utf8");
}

export function loadSnapshot(rootDir = root) {
  const path = resolve(rootDir, SNAPSHOT_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}; run node scripts/ci/check-schema-compat.mjs --update`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeSnapshot(current, rootDir = root) {
  writeFileSync(resolve(rootDir, SNAPSHOT_PATH), `${JSON.stringify(current, null, 2)}\n`);
}

export function checkSchemaCompat({ rootDir = root, update = false } = {}) {
  const source = readSchema(rootDir);
  const current = snapshotSchema(source);
  if (update) {
    writeSnapshot(current, rootDir);
    return [];
  }
  return schemaViolations(loadSnapshot(rootDir), current, allowedTightenings(source));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const update = process.argv.slice(2).includes("--update");
  try {
    const violations = checkSchemaCompat({ update });
    if (update) {
      console.log(`Wrote ${SNAPSHOT_PATH}`);
    } else if (violations.length > 0) {
      for (const violation of violations) console.error(violation);
      process.exitCode = 1;
    } else {
      console.log("Schema compatibility snapshot is current.");
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
