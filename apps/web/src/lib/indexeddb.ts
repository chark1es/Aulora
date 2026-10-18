/**
 * Tiny promise-based IndexedDB key/value helper for the web client.
 *
 * Used only for device-local data: the search index and the offline outbox.
 * Nothing here is ever sent to a server; message storage goes through Convex
 * instead.
 */

export interface KeyValueStore<T> {
  getAll(): Promise<T[]>;
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

const connections = new Map<string, Promise<IDBDatabase>>();

function openDatabase(name: string, storeName: string): Promise<IDBDatabase> {
  const existing = connections.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open IndexedDB"));
  });
  connections.set(name, promise);
  return promise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Deletes a database and forgets any cached connection to it. Used once to
 * discard legacy, unscoped data after a storage key changes (see
 * `search-store.ts`).
 */
export function deleteDatabase(name: string): Promise<void> {
  const existing = connections.get(name);
  connections.delete(name);
  return new Promise<void>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    if (existing !== undefined) {
      void existing
        .then((database) => {
          database.close();
        })
        .catch(() => undefined);
    }
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error("failed to delete IndexedDB"));
    };
    // An older tab holding the connection still leaves the name unused by new
    // code, so a blocked delete must not strand the caller.
    request.onblocked = () => {
      resolve();
    };
  });
}

/** Opens (or reuses) a keyspace in a named IndexedDB database. */
export function openKeyValueStore<T>(databaseName: string, storeName: string): KeyValueStore<T> {
  const database = openDatabase(databaseName, storeName);

  async function run<R>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    const db = await database;
    const transaction = db.transaction(storeName, mode);
    const result = await requestToPromise(operation(transaction.objectStore(storeName)));
    await transactionDone(transaction);
    return result;
  }

  return {
    async getAll() {
      return (await run("readonly", (store) => store.getAll())) as T[];
    },
    async get(key) {
      return (await run("readonly", (store) => store.get(key))) as T | undefined;
    },
    async put(key, value) {
      await run("readwrite", (store) => store.put(value, key));
    },
    async delete(key) {
      await run("readwrite", (store) => store.delete(key));
    },
    async clear() {
      await run("readwrite", (store) => store.clear());
    },
  };
}
