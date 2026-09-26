import {
  createReactNativeMlsEngine,
  installReactNativeCrypto,
  type KeyStore,
  type MlsEngine,
} from "@aulora/crypto";
import { install } from "react-native-quick-crypto";

/**
 * Installs `react-native-quick-crypto`'s native WebCrypto polyfill. Hermes has
 * `getRandomValues` but no `crypto.subtle`; the ts-mls engine needs subtle for
 * X25519/Ed25519/HKDF/AES-GCM. This must run before any MLS engine is built.
 *
 * Idempotent: `installReactNativeCrypto` only calls `install()` while
 * `crypto.subtle` is missing, so this is safe to call on every engine.
 */
export function ensureReactNativeCrypto(): void {
  installReactNativeCrypto({ install });
}

/**
 * One MLS engine per channel over the shared device key store. This is the
 * mobile counterpart of the web `createWebMlsEngine`: the same ts-mls engine,
 * with the quick-crypto polyfill installed.
 */
export function mobileMlsEngine(keyStore: KeyStore): MlsEngine {
  ensureReactNativeCrypto();
  return createReactNativeMlsEngine({ keyStore, quickCrypto: { install } });
}
