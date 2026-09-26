import { memoryOutboxStore, type OutboxItem, type OutboxStore } from "@aulora/core";
import { openKeyValueStore } from "./indexeddb";

const DATABASE = "aulora-outbox";
const STORE = "sends";

/** IndexedDB-backed outbox store; falls back to memory off-browser. */
export function webOutboxStore(): OutboxStore {
  if (typeof indexedDB === "undefined") {
    return memoryOutboxStore();
  }
  const store = openKeyValueStore<OutboxItem>(DATABASE, STORE);
  return {
    async readAll() {
      return await store.getAll();
    },
    async put(item) {
      await store.put(item.id, item);
    },
    async delete(id) {
      await store.delete(id);
    },
  };
}
