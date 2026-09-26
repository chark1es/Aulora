/**
 * Native key-store adapter stubs.
 *
 * These are intentionally unimplemented: the web build uses
 * `indexedDbKeyStore()`. The native adapters land with their phases and must
 * implement the same {@link KeyStore} contract, backed by the OS keystore so
 * the device identity and MLS state are never stored as plain bytes.
 */

import { MlsEngineError } from "./errors.js";
import type { KeyStore } from "./keystore.js";

const PHASE_4_MESSAGE =
  "tauriKeychainKeyStore() arrives in Phase 4 (Tauri desktop): implement KeyStore over the " +
  "macOS Keychain / Windows Credential Manager / Linux Secret Service. Not implemented yet.";

const PHASE_5_MESSAGE =
  "expoSecureStoreKeyStore() arrives in Phase 5 (Expo iOS/Android): implement KeyStore over " +
  "expo-secure-store (iOS Keychain / Android Keystore). Not implemented yet.";

/** Phase 4 stub. See {@link PHASE_4_MESSAGE}. */
export function tauriKeychainKeyStore(): KeyStore {
  throw new MlsEngineError("not-implemented", PHASE_4_MESSAGE);
}

/** Phase 5 stub. See {@link PHASE_5_MESSAGE}. */
export function expoSecureStoreKeyStore(): KeyStore {
  throw new MlsEngineError("not-implemented", PHASE_5_MESSAGE);
}
