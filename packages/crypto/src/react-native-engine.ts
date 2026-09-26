/**
 * React Native (iOS / Android, Hermes) MLS engine backed by the web ts-mls
 * engine plus `react-native-quick-crypto`.
 *
 * ## Why this is not OpenMLS
 *
 * `ts-mls@1.6.4` only needs WebCrypto `subtle` for X25519 keygen/DH (through
 * `@hpke/core`) and, depending on the provider, AES-GCM, HKDF, HMAC and digest.
 * Hermes/Expo has no `crypto.subtle`, but `react-native-quick-crypto` 1.x ships
 * a native OpenSSL-backed `subtle` that implements every one of those
 * primitives. So the cheapest working path is to install that polyfill and reuse
 * the *same* `createWebMlsEngine()` implementation, not to build a second engine.
 *
 * This module is deliberately Expo-free: the app injects its `quickCrypto`
 * module (the `install` export from `react-native-quick-crypto`), so the package
 * keeps no React Native dependency. The {@link NativeMlsBridge} OpenMLS boundary
 * in `native-engine.ts` remains as an alternative for a future Rust core.
 *
 * ## Wiring
 *
 * 1. `createReactNativeMlsEngine()` calls `install()` once (only when
 *    `globalThis.crypto.subtle` is absent) so `globalThis.crypto` is the
 *    quick-crypto WebCrypto. `@hpke/core` reads `globalThis.crypto.subtle`
 *    directly, so patching the global is required, not just passing `crypto`.
 * 2. It then delegates to {@link createWebMlsEngine} under the same
 *    {@link MlsEngine} interface and the same persisted key store.
 * 3. {@link probeReactNativeCrypto} verifies the exact primitives on-device;
 *    call it before trusting a build (see `packages/crypto/MOBILE.md`).
 */

import type { MlsEngine } from "./engine.js";
import { MlsEngineError } from "./errors.js";
import type { KeyStore } from "./keystore.js";
import { createWebMlsEngine, type DeviceIdentity, type WebMlsEngineOptions } from "./web-engine.js";

/** The parts of `react-native-quick-crypto` the engine uses. */
export interface ReactNativeQuickCrypto {
  /**
   * Patches `globalThis.crypto` with the native WebCrypto (and `globalThis`).
   * Idempotent: only called when `crypto.subtle` is missing.
   */
  readonly install?: () => void;
  /**
   * The module's native `subtle`. Used as a fallback when `install()` cannot
   * replace `globalThis.crypto` (a runtime that defines it as an accessor or
   * non-writable property makes the plain assignment inside `install()` a
   * no-op), so the engine never depends on that assignment sticking.
   */
  readonly subtle?: SubtleCrypto;
  /** The module's native `getRandomValues`, paired with {@link subtle}. */
  readonly getRandomValues?: Crypto["getRandomValues"];
}

/**
 * Message used when the native crypto is absent (e.g. Expo Go without a dev
 * build). Kept free of secrets and safe to surface in the UI.
 */
export const REACT_NATIVE_MLS_UNAVAILABLE =
  "react-native-quick-crypto is not installed in this build, so crypto.subtle is " +
  "unavailable and MLS cannot encrypt. Use an Expo dev build / prebuild (not Expo Go) " +
  "with react-native-quick-crypto, then call installReactNativeCrypto().";

/**
 * Installs the quick-crypto polyfill into `globalThis` and returns the WebCrypto
 * to use. Throws a typed {@link MlsEngineError} (`not-implemented`) when the
 * module is missing, so callers never silently run without encryption.
 */
export function installReactNativeCrypto(quickCrypto: ReactNativeQuickCrypto): Crypto {
  if (globalThis.crypto?.subtle === undefined) {
    quickCrypto.install?.();
  }
  if (globalThis.crypto?.subtle === undefined && quickCrypto.subtle !== undefined) {
    defineGlobalCrypto(quickCrypto.subtle, quickCrypto.getRandomValues);
  }
  const crypto = globalThis.crypto as Crypto | undefined;
  if (crypto?.subtle === undefined) {
    throw new MlsEngineError("not-implemented", REACT_NATIVE_MLS_UNAVAILABLE);
  }
  return crypto;
}

/**
 * Forces `globalThis.crypto` to a WebCrypto built from the native `subtle`,
 * keeping any existing `getRandomValues`. `defineProperty` succeeds where a
 * plain assignment is silently dropped (accessor without setter, or a
 * non-writable but configurable property).
 */
function defineGlobalCrypto(
  subtle: SubtleCrypto,
  getRandomValues: Crypto["getRandomValues"] | undefined,
): void {
  const existing = globalThis.crypto as Partial<Crypto> | undefined;
  const random = getRandomValues ?? existing?.getRandomValues?.bind(existing);
  const patched = { ...existing, subtle, getRandomValues: random } as Crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      value: patched,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch {
    // Non-configurable global: nothing more can be done; the caller throws.
  }
}

export interface ReactNativeMlsEngineOptions {
  /** Encrypted key store for identity, KeyPackages and group state. */
  readonly keyStore: KeyStore;
  /** The injected `react-native-quick-crypto` module. */
  readonly quickCrypto: ReactNativeQuickCrypto;
  /** Override the device identity instead of generating one. */
  readonly identity?: DeviceIdentity;
  /** Ciphersuite; defaults to the Aulora ciphersuite. */
  readonly cipherSuite?: WebMlsEngineOptions["cipherSuite"];
  /**
   * Override the WebCrypto used by the engine. Defaults to the installed
   * `globalThis.crypto`. `globalThis.crypto` is patched either way, because
   * `@hpke/core` reads it directly. Tests use this to inject a deterministic
   * crypto.
   */
  readonly crypto?: Crypto;
}

/**
 * Creates the iOS/Android MLS engine over `react-native-quick-crypto`. This is a
 * drop-in for {@link createWebMlsEngine} on mobile: it installs the polyfill and
 * reuses the ts-mls engine behind the same {@link MlsEngine} interface.
 */
export function createReactNativeMlsEngine(options: ReactNativeMlsEngineOptions): MlsEngine {
  const installed = installReactNativeCrypto(options.quickCrypto);
  const crypto = options.crypto ?? installed;
  return createWebMlsEngine({
    keyStore: options.keyStore,
    crypto,
    ...(options.identity !== undefined ? { identity: options.identity } : {}),
    ...(options.cipherSuite !== undefined ? { cipherSuite: options.cipherSuite } : {}),
  });
}

/** Per-primitive support report for the exact operations ts-mls needs. */
export interface ReactNativeCryptoReport {
  readonly subtle: boolean;
  readonly randomValues: boolean;
  readonly x25519: boolean;
  readonly ed25519: boolean;
  readonly hkdf: boolean;
  readonly hmac: boolean;
  readonly aesGcm: boolean;
  readonly digest: boolean;
}

const X25519_BASE_POINT = (() => {
  const point = new Uint8Array(32);
  point[0] = 9;
  return point;
})();

/**
 * Probes the WebCrypto for every primitive `ts-mls` / `@hpke/core` use, mirroring
 * their exact calls. Returns a per-primitive report instead of throwing so a
 * caller (or a device smoke test) can decide. On Node's WebCrypto — the same
 * primitive set quick-crypto targets — every field is `true`.
 */
export async function probeReactNativeCrypto(
  crypto: Crypto = globalThis.crypto as Crypto,
): Promise<ReactNativeCryptoReport> {
  const subtle = crypto?.subtle;
  if (subtle === undefined) {
    return {
      subtle: false,
      randomValues: false,
      x25519: false,
      ed25519: false,
      hkdf: false,
      hmac: false,
      aesGcm: false,
      digest: false,
    };
  }
  const [digest, hmac, hkdf, x25519, ed25519, aesGcm] = await Promise.all([
    succeeds(() => subtle.digest("SHA-256", new Uint8Array(8))),
    succeeds(async () => {
      const key = await subtle.importKey(
        "raw",
        new Uint8Array(32),
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"],
      );
      await subtle.sign("HMAC", key, new Uint8Array(8));
    }),
    succeeds(async () => {
      const key = await subtle.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveBits"]);
      await subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0) },
        key,
        256,
      );
    }),
    succeeds(async () => {
      const pair = (await subtle.generateKey({ name: "X25519" }, true, [
        "deriveBits",
      ])) as CryptoKeyPair;
      const base = await subtle.importKey("raw", X25519_BASE_POINT, { name: "X25519" }, true, []);
      await subtle.deriveBits({ name: "X25519", public: base }, pair.privateKey, 256);
    }),
    succeeds(async () => {
      const pair = (await subtle.generateKey({ name: "Ed25519" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const signature = await subtle.sign({ name: "Ed25519" }, pair.privateKey, new Uint8Array(8));
      const valid = await subtle.verify(
        { name: "Ed25519" },
        pair.publicKey,
        signature,
        new Uint8Array(8),
      );
      if (!valid) {
        throw new Error("Ed25519 verify returned false");
      }
    }),
    succeeds(async () => {
      const key = (await subtle.generateKey({ name: "AES-GCM", length: 128 }, true, [
        "encrypt",
        "decrypt",
      ])) as CryptoKey;
      const iv = new Uint8Array(12);
      const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(4));
      await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    }),
  ]);
  return {
    subtle: true,
    randomValues: typeof crypto?.getRandomValues === "function",
    x25519,
    ed25519,
    hkdf,
    hmac,
    aesGcm,
    digest,
  };
}

/** `true` when every primitive in the report is supported. */
export function isReactNativeCryptoSufficient(report: ReactNativeCryptoReport): boolean {
  return (
    report.subtle &&
    report.randomValues &&
    report.x25519 &&
    report.ed25519 &&
    report.hkdf &&
    report.hmac &&
    report.aesGcm &&
    report.digest
  );
}

async function succeeds(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}
