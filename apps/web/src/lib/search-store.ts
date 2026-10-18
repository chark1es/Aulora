/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  memorySearchStore,
  type SearchDocument,
  type SearchStore,
  searchScopeKey,
} from "@aulora/core";
import { deleteDatabase, type KeyValueStore, openKeyValueStore } from "./indexeddb";

/** The database the pre-scoping index used; superseded by per-instance names. */
export const LEGACY_SEARCH_DATABASE = "aulora-search";

const STORE = "messages";
const PREFIX = `${LEGACY_SEARCH_DATABASE}:`;

/**
 * IndexedDB database name for one server and account. The pre-scoping build
 * shared a single `aulora-search` database across every workspace and account,
 * so a fresh instance inherited decrypted messages from whatever ran before it
 * on the same origin. Namespacing by scope keeps each instance's index private.
 */
export function searchDatabaseName(serverUrl: string, userId: string): string {
  return `${PREFIX}${searchScopeKey(serverUrl, userId)}`;
}

let legacyDiscard: Promise<void> | undefined;

/**
 * Deletes the legacy unscoped database once per page load. Its documents
 * belonged to no known instance, so keeping them would reintroduce the bug;
 * they are re-read from the server on demand.
 */
export function discardLegacySearchIndex(): Promise<void> {
  legacyDiscard ??= deleteDatabase(LEGACY_SEARCH_DATABASE);
  return legacyDiscard;
}

/**
 * Builds a {@link SearchStore} for one instance over an injectable key/value
 * opener, so the scoping can be exercised without a real IndexedDB.
 */
export function scopedSearchStore(
  serverUrl: string,
  userId: string,
  open: (databaseName: string, storeName: string) => KeyValueStore<SearchDocument>,
): SearchStore {
  const store = open(searchDatabaseName(serverUrl, userId), STORE);
  return {
    async readAll() {
      return await store.getAll();
    },
    async put(document) {
      await store.put(document.messageId, document);
    },
    async delete(messageId) {
      await store.delete(messageId);
    },
    async clear() {
      await store.clear();
    },
  };
}

/** IndexedDB-backed search index store for one instance; memory off-browser. */
export function webSearchStore(serverUrl: string, userId: string): SearchStore {
  if (typeof indexedDB === "undefined") {
    return memorySearchStore();
  }
  void discardLegacySearchIndex();
  return scopedSearchStore(serverUrl, userId, openKeyValueStore);
}
