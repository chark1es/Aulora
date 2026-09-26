/**
 * Web key store: Aulora's encrypted MLS records live in IndexedDB.
 *
 * Records are wrapped by `createEncryptedKeyStore` with a non-extractable
 * AES-GCM `CryptoKey`; only that wrapping key is stored in the clear inside
 * IndexedDB, and it cannot be exported. The browser, not this code, guards it.
 */

import type { EncryptedKeyStoreBackend, KeyStore } from "./keystore.js";
import { createEncryptedKeyStore } from "./keystore.js";

const VALUE_STORE = "values";
const WRAPPING_KEY_STORE = "wrapping-keys";
const DEVICE_WRAPPING_KEY = "device";

export interface IndexedDbKeyStoreOptions {
  /** IndexedDB database name. Defaults to `aulora-crypto`. */
  databaseName?: string;
  /** IndexedDB factory; defaults to the global. Injectable for tests. */
  indexedDB?: IDBFactory;
  /** Crypto implementation; defaults to the global. Injectable for tests. */
  crypto?: Crypto;
}

/** Encrypted {@link KeyStore} backed by IndexedDB. */
export function indexedDbKeyStore(options: IndexedDbKeyStoreOptions = {}): KeyStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    throw new Error("@aulora/crypto: IndexedDB is not available in this environment");
  }
  const database = openDatabase(factory, options.databaseName ?? "aulora-crypto");
  const backend: EncryptedKeyStoreBackend = {
    readValue: async (key) => readRecord<Uint8Array>(database, VALUE_STORE, key),
    writeValue: async (key, value) => {
      await writeRecord(database, VALUE_STORE, value, key);
    },
    deleteValue: async (key) => {
      await deleteRecord(database, VALUE_STORE, key);
    },
    listKeys: (prefix) => listKeys(database, VALUE_STORE, prefix),
    readWrappingKey: () => readRecord<CryptoKey>(database, WRAPPING_KEY_STORE, DEVICE_WRAPPING_KEY),
    writeWrappingKey: async (key) => {
      await writeRecord(database, WRAPPING_KEY_STORE, key, DEVICE_WRAPPING_KEY);
    },
  };
  return createEncryptedKeyStore(backend, options.crypto ?? globalThis.crypto);
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VALUE_STORE)) {
        database.createObjectStore(VALUE_STORE);
      }
      if (!database.objectStoreNames.contains(WRAPPING_KEY_STORE)) {
        database.createObjectStore(WRAPPING_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open IndexedDB"));
  });
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

async function readRecord<T>(
  database: Promise<IDBDatabase>,
  storeName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await database;
  const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
  return requestToPromise<T | undefined>(request as IDBRequest<T | undefined>);
}

async function writeRecord(
  database: Promise<IDBDatabase>,
  storeName: string,
  value: unknown,
  key: IDBValidKey,
): Promise<void> {
  const db = await database;
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value, key);
  await transactionDone(transaction);
}

async function deleteRecord(
  database: Promise<IDBDatabase>,
  storeName: string,
  key: IDBValidKey,
): Promise<void> {
  const db = await database;
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

async function listKeys(
  database: Promise<IDBDatabase>,
  storeName: string,
  prefix?: string,
): Promise<string[]> {
  const db = await database;
  const allKeys = await requestToPromise(
    db.transaction(storeName, "readonly").objectStore(storeName).getAllKeys(),
  );
  return allKeys
    .filter((key): key is string => typeof key === "string")
    .filter((key) => !prefix || key.startsWith(prefix))
    .sort();
}
