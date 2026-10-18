/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { SearchDocument } from "@aulora/core";
import { SearchIndex } from "@aulora/core";
import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "../lib/indexeddb";
import {
  discardLegacySearchIndex,
  LEGACY_SEARCH_DATABASE,
  scopedSearchStore,
  searchDatabaseName,
} from "../lib/search-store";

const doc = (messageId: string, text: string): SearchDocument => ({
  messageId,
  channelId: "c1",
  authorId: "u1",
  text,
  createdAt: 0,
});

/**
 * An in-memory stand-in for the IndexedDB helper. Keyspaces are keyed by
 * database name, exactly as the real opener reuses one connection per name, so
 * two scopes that build the same name would share documents (the original bug).
 */
function fakeIndexedDb() {
  const databases = new Map<string, Map<string, SearchDocument>>();
  const opened: string[] = [];
  const open = (databaseName: string, _storeName: string): KeyValueStore<SearchDocument> => {
    opened.push(databaseName);
    const rows = databases.get(databaseName) ?? new Map<string, SearchDocument>();
    databases.set(databaseName, rows);
    return {
      async getAll() {
        return [...rows.values()];
      },
      async get(key) {
        return rows.get(key);
      },
      async put(key, value) {
        rows.set(key, value);
      },
      async delete(key) {
        rows.delete(key);
      },
      async clear() {
        rows.clear();
      },
    };
  };
  return { databases, opened, open };
}

describe("web search store scoping", () => {
  it("does not surface another instance's messages on a fresh instance", async () => {
    const fake = fakeIndexedDb();
    const openAt = (server: string, user: string) => scopedSearchStore(server, user, fake.open);

    // Instance A indexed a message containing "test".
    const indexA = new SearchIndex(openAt("https://a.example", "u1"));
    await indexA.load();
    await indexA.index(doc("a-1", "the test deployment is up"));
    expect(indexA.query("test")).toHaveLength(1);

    // A fresh instance B on the same origin must not see A's documents.
    const indexB = new SearchIndex(openAt("https://b.example", "u1"));
    await indexB.load();
    expect(indexB.query("test")).toHaveLength(0);
    expect(indexB.size).toBe(0);

    // The same instance with a different account is isolated too.
    const indexC = new SearchIndex(openAt("https://a.example", "u2"));
    await indexC.load();
    expect(indexC.query("test")).toHaveLength(0);
  });

  it("reuses one keyspace for the same scope so history survives a reload", async () => {
    const fake = fakeIndexedDb();
    const store = () => scopedSearchStore("https://a.example", "u1", fake.open);

    const first = new SearchIndex(store());
    await first.load();
    await first.index(doc("a-1", "persisted test message"));

    const reopened = new SearchIndex(store());
    await reopened.load();
    expect(reopened.query("test").map((hit) => hit.messageId)).toEqual(["a-1"]);
  });

  it("names scoped databases away from the legacy unscoped one", () => {
    const scoped = searchDatabaseName("https://a.example", "u1");
    expect(scoped).not.toBe(LEGACY_SEARCH_DATABASE);
    expect(scoped.startsWith(`${LEGACY_SEARCH_DATABASE}:`)).toBe(true);
    expect(searchDatabaseName("https://a.example", "u1")).not.toBe(
      searchDatabaseName("https://b.example", "u1"),
    );
    expect(searchDatabaseName("https://a.example", "u1")).not.toBe(
      searchDatabaseName("https://a.example", "u2"),
    );
  });

  it("discards the legacy unscoped index without throwing", async () => {
    // jsdom has no IndexedDB, so the migration must resolve as a no-op rather
    // than reject and break provider startup.
    await expect(discardLegacySearchIndex()).resolves.toBeUndefined();
  });
});
