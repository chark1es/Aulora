/**
 * Key storage for MLS state and the device identity.
 *
 * The public {@link KeyStore} is a byte-oriented key/value store: this shape
 * maps cleanly onto IndexedDB (web), the Tauri keychain (Phase 4) and Expo
 * SecureStore (Phase 5). All Aulora crypto records are written through
 * {@link createEncryptedKeyStore}, which wraps every value with a
 * non-extractable AES-GCM `CryptoKey`, so raw private keys never sit in plain
 * storage.
 */

import { MlsEngineError } from "./errors.js";

/** Byte-oriented, namespaced key/value storage. */
export interface KeyStore {
  /** Read a record, or `undefined` if absent. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Write a record, overwriting any existing value. */
  set(key: string, value: Uint8Array): Promise<void>;
  /** Remove a record if present. */
  delete(key: string): Promise<void>;
  /** List keys, optionally filtered by prefix, in deterministic order. */
  keys(prefix?: string): Promise<string[]>;
}

/**
 * Low-level storage used by {@link createEncryptedKeyStore}. Adapters
 * implement this to reuse Aulora's record encryption for free.
 */
export interface EncryptedKeyStoreBackend {
  readValue(key: string): Promise<Uint8Array | undefined>;
  writeValue(key: string, value: Uint8Array): Promise<void>;
  deleteValue(key: string): Promise<void>;
  listKeys(prefix?: string): Promise<string[]>;
  readWrappingKey(): Promise<CryptoKey | undefined>;
  writeWrappingKey(key: CryptoKey): Promise<void>;
}

const WRAPPING_KEY_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const GCM_IV_BYTES = 12;

/** TS 5.9 narrows `Uint8Array` to `ArrayBufferLike`; WebCrypto wants `ArrayBuffer`. */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

/**
 * Wrap a backend so every record is encrypted at rest with a non-extractable
 * AES-GCM key. Only the wrapping key is stored unwrapped (as a `CryptoKey`),
 * and it can never be exported.
 */
export function createEncryptedKeyStore(
  backend: EncryptedKeyStoreBackend,
  cryptoImpl: Crypto = globalThis.crypto,
): KeyStore {
  let wrappingKey: Promise<CryptoKey> | undefined;

  const getWrappingKey = (): Promise<CryptoKey> => {
    wrappingKey ??= (async () => {
      const existing = await backend.readWrappingKey();
      if (existing) {
        return existing;
      }
      const generated = await cryptoImpl.subtle.generateKey(WRAPPING_KEY_ALGORITHM, false, [
        "encrypt",
        "decrypt",
      ]);
      await backend.writeWrappingKey(generated);
      return generated;
    })();
    return wrappingKey;
  };

  return {
    async get(key) {
      const stored = await backend.readValue(key);
      if (!stored) {
        return undefined;
      }
      const keyMaterial = await getWrappingKey();
      const iv = stored.slice(0, GCM_IV_BYTES);
      const ciphertext = stored.slice(GCM_IV_BYTES);
      try {
        const plaintext = await cryptoImpl.subtle.decrypt(
          { name: "AES-GCM", iv },
          keyMaterial,
          ciphertext,
        );
        return new Uint8Array(plaintext);
      } catch {
        throw new MlsEngineError("decode", "stored crypto record failed authentication");
      }
    },
    async set(key, value) {
      const keyMaterial = await getWrappingKey();
      const iv = cryptoImpl.getRandomValues(new Uint8Array(GCM_IV_BYTES));
      const ciphertext = new Uint8Array(
        await cryptoImpl.subtle.encrypt(
          { name: "AES-GCM", iv },
          keyMaterial,
          toBufferSource(value),
        ),
      );
      const record = new Uint8Array(iv.length + ciphertext.length);
      record.set(iv, 0);
      record.set(ciphertext, iv.length);
      await backend.writeValue(key, record);
    },
    async delete(key) {
      await backend.deleteValue(key);
    },
    async keys(prefix) {
      return backend.listKeys(prefix);
    },
  };
}

/** In-memory {@link KeyStore}; the documented fallback for tests. */
export function memoryKeyStore(cryptoImpl: Crypto = globalThis.crypto): KeyStore {
  const values = new Map<string, Uint8Array>();
  let wrappingKey: CryptoKey | undefined;
  return createEncryptedKeyStore(
    {
      readValue: async (key) => values.get(key),
      writeValue: async (key, value) => {
        values.set(key, value);
      },
      deleteValue: async (key) => {
        values.delete(key);
      },
      listKeys: async (prefix) =>
        [...values.keys()].filter((key) => !prefix || key.startsWith(prefix)).sort(),
      readWrappingKey: async () => wrappingKey,
      writeWrappingKey: async (key) => {
        wrappingKey = key;
      },
    },
    cryptoImpl,
  );
}
