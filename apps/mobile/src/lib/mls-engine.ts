import {
  createReactNativeMlsEngine,
  installReactNativeCrypto,
  type KeyStore,
  type MlsEngine,
} from "@aulora/crypto";
import { getRandomValues, install, subtle } from "react-native-quick-crypto";

/**
 * The quick-crypto pieces the engine needs. `subtle` and `getRandomValues` let
 * `installReactNativeCrypto` define `globalThis.crypto` itself when the
 * runtime ignores `install()`'s plain `global.crypto =` assignment.
 */
const quickCrypto = {
  install,
  subtle: subtle as unknown as SubtleCrypto,
  getRandomValues: getRandomValues as unknown as Crypto["getRandomValues"],
};

/**
 * Installs `react-native-quick-crypto`'s native WebCrypto polyfill. Hermes has
 * `getRandomValues` but no `crypto.subtle`; the ts-mls engine needs subtle for
 * X25519/Ed25519/HKDF/AES-GCM. This must run before any MLS engine is built.
 *
 * Idempotent: `installReactNativeCrypto` only calls `install()` while
 * `crypto.subtle` is missing, so this is safe to call on every engine.
 */
export function ensureReactNativeCrypto(): void {
  installReactNativeCrypto(quickCrypto);
}

/**
 * One MLS engine per channel over the shared device key store. This is the
 * mobile counterpart of the web `createWebMlsEngine`: the same ts-mls engine,
 * with the quick-crypto polyfill installed.
 */
export function mobileMlsEngine(keyStore: KeyStore): MlsEngine {
  ensureReactNativeCrypto();
  return createReactNativeMlsEngine({ keyStore, quickCrypto });
}
