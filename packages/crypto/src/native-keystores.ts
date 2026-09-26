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
 * real OS keychain.
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
  "expoSecureStoreKeyStore() arrives in Phase 5 (Expo iOS/Android): implement KeyStore over " +
  "expo-secure-store (iOS Keychain / Android Keystore). Not implemented yet.";

/** Phase 5 stub. See {@link PHASE_5_MESSAGE}. */
export function expoSecureStoreKeyStore(): KeyStore {
  throw new MlsEngineError("not-implemented", PHASE_5_MESSAGE);
}
