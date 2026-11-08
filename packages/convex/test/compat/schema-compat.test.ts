import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import type { Test } from "../helpers";
import { modules } from "../setup";

type Doc = Record<string, unknown>;

/**
 * Synthetic documents shaped like a previously supported release, one folder
 * per version. They contain no real user data. New releases add a folder; the
 * existing folders keep guarding the current schema against a tightening that
 * would reject already-stored rows.
 */
const fixtures = import.meta.glob<Doc[]>("../fixtures/compat/**/*.json", {
  eager: true,
  import: "default",
});

function documentsByTable(): Map<string, Doc[]> {
  const tables = new Map<string, Doc[]>();
  for (const [path, documents] of Object.entries(fixtures)) {
    if (!Array.isArray(documents)) {
      throw new Error(`Fixture ${path} must export an array of documents.`);
    }
    const name = path.split("/").at(-1) ?? path;
    tables.set(name.replace(/\.json$/, ""), documents);
  }
  return tables;
}

async function insertSimple(
  t: Test,
  table: "server" | "instanceSettings" | "roles" | "members",
  documents: readonly Doc[],
): Promise<void> {
  for (const document of documents) {
    const normalized =
      table === "roles"
        ? {
            ...document,
            permissions:
              typeof document.permissions === "string"
                ? BigInt(document.permissions)
                : document.permissions,
          }
        : document;
    await t.run(async (ctx) => {
      switch (table) {
        case "server":
          await ctx.db.insert("server", normalized as never);
          break;
        case "instanceSettings":
          await ctx.db.insert("instanceSettings", normalized as never);
          break;
        case "roles":
          await ctx.db.insert("roles", normalized as never);
          break;
        case "members":
          await ctx.db.insert("members", normalized as never);
          break;
      }
    });
  }
}

describe("schema compatibility with supported older releases", () => {
  it("accepts every fixture document through the current validators", async () => {
    const t = convexTest(schema, modules);
    const tables = documentsByTable();
    expect(tables.size).toBeGreaterThan(0);

    await insertSimple(t, "server", tables.get("server") ?? []);
    await insertSimple(t, "instanceSettings", tables.get("instanceSettings") ?? []);
    await insertSimple(t, "roles", tables.get("roles") ?? []);
    await insertSimple(t, "members", tables.get("members") ?? []);

    const channelIds: string[] = [];
    for (const document of tables.get("channels") ?? []) {
      channelIds.push(
        await t.run(async (ctx) => await ctx.db.insert("channels", document as never)),
      );
    }
    expect(channelIds.length).toBeGreaterThan(0);

    for (const document of tables.get("messages") ?? []) {
      for (const channelId of channelIds) {
        await t.run(
          async (ctx) => await ctx.db.insert("messages", { ...document, channelId } as never),
        );
      }
    }
    for (const document of tables.get("readStates") ?? []) {
      for (const channelId of channelIds) {
        await t.run(
          async (ctx) => await ctx.db.insert("readStates", { ...document, channelId } as never),
        );
      }
    }
  });
});
