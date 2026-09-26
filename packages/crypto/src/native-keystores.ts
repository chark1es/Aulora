/**
 * Native key-store adapters.
 *
 * The web build uses {@link indexedDbKeyStore}, which wraps every record with a
 * non-extractable AES-GCM key because IndexedDB itself is not a secret store.
 * The desktop adapter takes the opposite approach: each record is written as
 * its own OS keychain entry (macOS Keychain, Windows Credential Manager, Linux
 * Secret Service) through the Tauri Rust shell, so the operating system guards
 * the bytes at rest. A wrapping `CryptoKey` cannot be exported into a keychain,
 * which is why this adapter implements {@link KeyStore} directly instead of
 * composing {@link createEncryptedKeyStore}.
 *
 * Both adapters satisfy the same {@link KeyStore} contract. The Tauri adapter is
 * injectable with a transport so the contract is unit-tested without touching a
 * real OS keychain. The Phase 4 mobile adapter, {@link expoSecureStoreKeyStore},
 * is injectable with the `expo-secure-store` module for the same reason, and
 * keeps a JSON key index because SecureStore has no enumeration API.
 */

import { base64ToBytes, bytesToBase64 } from "./binary.js";
import { MlsEngineError } from "./errors.js";
import type { KeyStore } from "./keystore.js";

/** Prefix every Aulora MLS record is stored under. */
export const TAURI_KEYSTORE_PREFIX = "aulora/mls/";

/**
 * String transport to the desktop shell's keychain commands. Values cross the
 * boundary as base64 strings; the Rust side never interprets them.
 */
export interface TauriKeychainTransport {
  /** Returns the base64 value for `key`, or `null` when absent. */
  read(key: string): Promise<string | null>;
  /** Writes the base64 value for `key`, overwriting any existing entry. */
  write(key: string, base64Value: string): Promise<void>;
  /** Removes `key` if present. */
  remove(key: string): Promise<void>;
  /** Lists stored keys, optionally filtered by a prefix, in deterministic order. */
  list(prefix: string | null): Promise<string[]>;
}

export interface TauriKeychainKeyStoreOptions {
  /** Injected transport; defaults to the `window.__TAURI__` invoke bridge. */
  readonly transport?: TauriKeychainTransport;
  /** Prefix Aulora records live under. Defaults to {@link TAURI_KEYSTORE_PREFIX}. */
  readonly prefix?: string;
}

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function resolveTauriInvoke(): TauriInvoke {
  const global = globalThis as {
    __TAURI__?: {
      core?: { invoke?: unknown };
      invoke?: unknown;
    };
  };
  const candidate = global.__TAURI__?.core?.invoke ?? global.__TAURI__?.invoke;
  if (typeof candidate !== "function") {
    throw new MlsEngineError(
      "not-implemented",
      "tauriKeychainKeyStore() requires the Tauri runtime; the __TAURI__ invoke bridge is missing.",
    );
  }
  return candidate as TauriInvoke;
}

/**
 * Transport backed by the desktop shell's `keychain_get`, `keychain_set`,
 * `keychain_delete` and `keychain_list` commands.
 */
export function tauriKeychainTransport(
  invoke: TauriInvoke = resolveTauriInvoke(),
): TauriKeychainTransport {
  return {
    async read(key) {
      const value = await invoke("keychain_get", { key });
      return typeof value === "string" ? value : null;
    },
    async write(key, base64Value) {
      await invoke("keychain_set", { key, value: base64Value });
    },
    async remove(key) {
      await invoke("keychain_delete", { key });
    },
    async list(prefix) {
      const keys = await invoke("keychain_list", { prefix });
      if (!Array.isArray(keys)) {
        return [];
      }
      return keys
        .filter((key): key is string => typeof key === "string")
        .sort((a, b) => a.localeCompare(b));
    },
  };
}

/**
 * Phase 4: encrypted {@link KeyStore} over the OS keychain, for the Tauri
 * desktop shell. Keys are transparently scoped with {@link TAURI_KEYSTORE_PREFIX}
 * so unrelated keychain entries are never listed or deleted.
 */
export function tauriKeychainKeyStore(options: TauriKeychainKeyStoreOptions = {}): KeyStore {
  const prefix = options.prefix ?? TAURI_KEYSTORE_PREFIX;
  const transport = options.transport ?? tauriKeychainTransport();
  const scoped = (key: string) => `${prefix}${key}`;

  return {
    async get(key) {
      const value = await transport.read(scoped(key));
      return value === null ? undefined : base64ToBytes(value);
    },
    async set(key, value) {
      await transport.write(scoped(key), bytesToBase64(value));
    },
    async delete(key) {
      await transport.remove(scoped(key));
    },
    async keys(filter) {
      const keys = await transport.list(prefix);
      return keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((key) => filter === undefined || key.startsWith(filter))
        .sort((a, b) => a.localeCompare(b));
    },
  };
}

const PHASE_5_MESSAGE =
  "expoSecureStoreKeyStore() needs the expo-secure-store module injected (iOS Keychain / Android Keystore). " +
  "Pass { secureStore } from the Expo app; expo-secure-store has no built-in enumeration, so an explicit key index is kept.";

/**
 * The tiny surface of `expo-secure-store` this adapter needs. Kept structural so
 * `@aulora/crypto` never has to depend on Expo: the mobile app passes
 * `import * as SecureStore from "expo-secure-store"` at construction.
 */
export interface ExpoSecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Prefix under which every Aulora MLS record is stored on mobile. */
export const EXPO_SECURE_STORE_PREFIX = "aulora.mls.";

/** Records larger than one SecureStore entry are split on this marker. */
const CHUNK_MARKER = "#";

/**
 * expo-secure-store values are capped (2048 bytes on Android in practice), so
 * records are base64-encoded and split into chunks below that limit.
 */
const MAX_CHUNK_CHARS = 1800;

export interface ExpoSecureStoreKeyStoreOptions {
  /**
   * The `expo-secure-store` module (or a compatible transport). Required: the
   * adapter never imports Expo itself so this package stays platform-agnostic.
   */
  readonly secureStore?: ExpoSecureStoreLike;
  /** Prefix Aulora records live under. Defaults to {@link EXPO_SECURE_STORE_PREFIX}. */
  readonly prefix?: string;
}

/**
 * Phase 4 mobile {@link KeyStore} over `expo-secure-store` (iOS Keychain /
 * Android Keystore). Values are base64-encoded and chunked; because
 * SecureStore has no enumeration API, a JSON key index is maintained in a
 * dedicated record so {@link KeyStore.keys} works.
 */
export function expoSecureStoreKeyStore(options: ExpoSecureStoreKeyStoreOptions = {}): KeyStore {
  const provided = options.secureStore;
  if (!provided) {
    throw new MlsEngineError("not-implemented", PHASE_5_MESSAGE);
  }
  const secureStore: ExpoSecureStoreLike = provided;
  const prefix = options.prefix ?? EXPO_SECURE_STORE_PREFIX;
  const indexKey = `${prefix}__keys__`;
  const scoped = (key: string) => `${prefix}${key}`;
  const chunkKey = (key: string, chunk: number) => `${scoped(key)}${CHUNK_MARKER}${chunk}`;

  function assertNoMarker(key: string): void {
    if (key.includes(CHUNK_MARKER)) {
      throw new MlsEngineError("decode", "key store keys must not contain the chunk marker");
    }
  }

  async function readIndex(): Promise<string[]> {
    const raw = await secureStore.getItemAsync(indexKey);
    if (raw === null) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((key): key is string => typeof key === "string")
        : [];
    } catch {
      return [];
    }
  }

  async function writeIndex(keys: readonly string[]): Promise<void> {
    await secureStore.setItemAsync(indexKey, JSON.stringify([...keys].sort()));
  }

  return {
    async get(key) {
      assertNoMarker(key);
      const meta = await secureStore.getItemAsync(scoped(key));
      if (meta === null) {
        return undefined;
      }
      let chunks: number;
      try {
        const parsed = JSON.parse(meta) as { chunks?: unknown };
        chunks = typeof parsed.chunks === "number" ? parsed.chunks : 1;
      } catch {
        chunks = 1;
      }
      let encoded = "";
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        const part = await secureStore.getItemAsync(chunkKey(key, chunk));
        if (part === null) {
          throw new MlsEngineError("decode", "stored crypto record is missing a chunk");
        }
        encoded += part;
      }
      return base64ToBytes(encoded);
    },
    async set(key, value) {
      assertNoMarker(key);
      const encoded = bytesToBase64(value);
      const chunks = Math.max(1, Math.ceil(encoded.length / MAX_CHUNK_CHARS));
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        await secureStore.setItemAsync(
          chunkKey(key, chunk),
          encoded.slice(chunk * MAX_CHUNK_CHARS, (chunk + 1) * MAX_CHUNK_CHARS),
        );
      }
      await secureStore.setItemAsync(scoped(key), JSON.stringify({ chunks }));
      const index = await readIndex();
      if (!index.includes(key)) {
        await writeIndex([...index, key]);
      }
    },
    async delete(key) {
      assertNoMarker(key);
      const meta = await secureStore.getItemAsync(scoped(key));
      if (meta !== null) {
        let chunks = 1;
        try {
          const parsed = JSON.parse(meta) as { chunks?: unknown };
          chunks = typeof parsed.chunks === "number" ? parsed.chunks : 1;
        } catch {
          chunks = 1;
        }
        for (let chunk = 0; chunk < chunks; chunk += 1) {
          await secureStore.deleteItemAsync(chunkKey(key, chunk));
        }
        await secureStore.deleteItemAsync(scoped(key));
      }
      const index = await readIndex();
      if (index.includes(key)) {
        await writeIndex(index.filter((existing) => existing !== key));
      }
    },
    async keys(filter) {
      const index = await readIndex();
      return index.filter((key) => filter === undefined || key.startsWith(filter));
    },
  };
}
