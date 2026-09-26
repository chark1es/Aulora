import { memorySearchStore, type SearchDocument, type SearchStore } from "@aulora/core";
import { openKeyValueStore } from "./indexeddb";

const DATABASE = "aulora-search";
const STORE = "messages";

/** IndexedDB-backed search index store; falls back to memory off-browser. */
export function webSearchStore(): SearchStore {
  if (typeof indexedDB === "undefined") {
    return memorySearchStore();
  }
  const store = openKeyValueStore<SearchDocument>(DATABASE, STORE);
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
