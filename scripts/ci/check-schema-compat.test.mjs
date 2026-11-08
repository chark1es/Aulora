import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  allowedTightenings,
  checkSchemaCompat,
  SCHEMA_PATH,
  SNAPSHOT_PATH,
  schemaViolations,
  snapshotSchema,
  writeSnapshot,
} from "./check-schema-compat.mjs";

const schema = (fields) => `import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  server: defineTable({
${fields}
  }).index("by_name", ["name"]),
  members: defineTable({
    userId: v.string(),
  }),
});
`;

describe("schema compatibility snapshot", () => {
  it("parses tables and top-level field optionality", () => {
    const parsed = snapshotSchema(
      schema(`    name: v.string(),
    nickname: v.optional(v.string()),`),
    );
    expect(parsed.tables.server.fields).toEqual({
      name: "required",
      nickname: "optional",
    });
    expect(parsed.tables.members.fields).toEqual({ userId: "required" });
  });

  it("fails when a field becomes required", () => {
    const before = snapshotSchema(
      schema(`    name: v.string(),
    nickname: v.optional(v.string()),`),
    );
    const after = snapshotSchema(
      schema(`    name: v.string(),
    nickname: v.string(),`),
    );
    expect(schemaViolations(before, after)).toEqual([
      "server.nickname: became required without a @compat-allow-tighten marker and backfill",
    ]);
  });

  it("fails on a new required field, a removed field, or a removed table", () => {
    const before = snapshotSchema(
      schema(`    name: v.string(),
    nickname: v.optional(v.string()),`),
    );
    expect(
      schemaViolations(
        before,
        snapshotSchema(
          schema(`    name: v.string(),
    nickname: v.optional(v.string()),
    requiredNew: v.string(),`),
        ),
      ),
    ).toEqual([
      "server.requiredNew: new required field needs a @compat-allow-tighten marker and backfill",
    ]);
    expect(schemaViolations(before, snapshotSchema(schema(`    name: v.string(),`)))).toEqual([
      "server.nickname: field was removed without a compatibility marker",
    ]);
    expect(schemaViolations(before, { tables: {} })).toEqual([
      "server: table was removed without a compatibility marker",
      "members: table was removed without a compatibility marker",
    ]);
  });

  it("allows a documented tightening", () => {
    const before = snapshotSchema(
      schema(`    name: v.string(),
    nickname: v.optional(v.string()),`),
    );
    const afterSource = schema(`    name: v.string(),
    // @compat-allow-tighten: server.nickname -- backfill released in 1.3.0
    nickname: v.string(),`);
    const allowed = allowedTightenings(afterSource);
    expect([...allowed]).toEqual(["server.nickname"]);
    expect(schemaViolations(before, snapshotSchema(afterSource), allowed)).toEqual([]);
  });

  it("refuses to regenerate the snapshot over an unmarked tightening", () => {
    const root = mkdtempSync(resolve(tmpdir(), "aulora-schema-"));
    try {
      const schemaPath = resolve(root, SCHEMA_PATH);
      const snapshotPath = resolve(root, SNAPSHOT_PATH);
      mkdirSync(dirname(schemaPath), { recursive: true });
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(schemaPath, schema(`    name: v.string(),
    nickname: v.optional(v.string()),`));
      const before = snapshotSchema(readFileSync(schemaPath, "utf8"));
      writeSnapshot(before, root);

      writeFileSync(schemaPath, schema(`    name: v.string(),
    nickname: v.string(),`));
      const violations = checkSchemaCompat({ rootDir: root, update: true });
      expect(violations.length).toBe(1);
      expect(JSON.parse(readFileSync(snapshotPath, "utf8"))).toEqual(before);

      writeFileSync(schemaPath, schema(`    name: v.string(),
    // @compat-allow-tighten: server.nickname -- backfill completed
    nickname: v.string(),`));
      expect(checkSchemaCompat({ rootDir: root, update: true })).toEqual([]);
      expect(
        JSON.parse(readFileSync(snapshotPath, "utf8")).tables.server.fields.nickname,
      ).toBe("required");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts the committed schema and snapshot", () => {
    expect(checkSchemaCompat()).toEqual([]);
  });
});
