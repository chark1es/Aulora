/**
 * Native (iOS / Android) OpenMLS engine boundary.
 *
 * ## Status
 *
 * Mobile E2EE does **not** wait on this boundary: the supported iOS/Android path
 * is {@link createReactNativeMlsEngine} in `react-native-engine.ts`, which
 * installs `react-native-quick-crypto`'s `crypto.subtle` and reuses the same
 * ts-mls engine as web. This module remains as the typed alternative for a
 * future OpenMLS (Rust) core.
 *
 * ## Why OpenMLS was originally chosen
 *
 * `ts-mls@1.6.4` needs `crypto.subtle` X25519/Ed25519/HKDF support that bare
 * Hermes/Expo does not provide, so the Phase 4 boundary was built for a real
 * OpenMLS build. That gap is now closed by `react-native-quick-crypto`
 * (see `packages/crypto/MOBILE.md`), which covers every primitive ts-mls uses.
 *
 * ## OpenMLS TODO (future work on the macOS host)
 *
 * 1. Build OpenMLS for `aarch64-apple-ios`, `aarch64-apple-darwin` and the
 *    Android ABIs via `cargo-ndk`.
 * 2. Wrap the `MlsGroup` API with UniFFI (or a small JSI module) exposing the
 *    twelve operations in {@link NativeMlsBridge} as async functions. Wire
 *    format is the MLS TLS encoding (`MlsMessageOut::tls_serialize`), matching
 *    the web engine so both peers interoperate.
 * 3. Provide `nativeMlsBridge()` in the Expo app that resolves the module and
 *    returns the bridge.
 * 4. Verify with the two-device conformance scenario in
 *    `packages/crypto/test/scenario.ts` plus an interop run against a `ts-mls`
 *    web peer.
 *
 * Without a bridge, `createNativeMlsEngine()` throws a typed
 * {@link MlsEngineError} (`not-implemented`) rather than silently pretending a
 * channel is encrypted.
 */

import type { AddMembersResult, MlsEngine, MlsMember } from "./engine.js";
import { MlsEngineError } from "./errors.js";

/** Human-readable status of the optional OpenMLS native build. */
export const NATIVE_MLS_TODO =
  "OpenMLS native engine is not built in this environment. Mobile E2EE uses " +
  "createReactNativeMlsEngine() (ts-mls over react-native-quick-crypto's crypto.subtle) " +
  "instead; this OpenMLS bridge remains for a future Rust core. See " +
  "packages/crypto/src/native-engine.ts and packages/crypto/MOBILE.md.";

/**
 * The native operations the OpenMLS module must expose. Every wire value is an
 * opaque `Uint8Array` (MLS TLS encoding), exactly like {@link MlsEngine}, so a
 * native bridge is a drop-in replacement for the web engine.
 */
export interface NativeMlsBridge {
  generateKeyPackage(): Promise<Uint8Array>;
  createGroup(groupId: Uint8Array, keyPackage: Uint8Array): Promise<void>;
  joinFromWelcome(welcome: Uint8Array, keyPackage: Uint8Array): Promise<void>;
  addMembers(keyPackages: readonly Uint8Array[]): Promise<AddMembersResult>;
  removeMembers(leafIndexes: readonly number[]): Promise<Uint8Array>;
  processCommit(commit: Uint8Array): Promise<void>;
  encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
  epoch(): Promise<bigint>;
  members(): Promise<readonly MlsMember[]>;
  exportState(): Promise<Uint8Array>;
  importState(state: Uint8Array): Promise<void>;
}

class OpenMlsEngine implements MlsEngine {
  private readonly bridge: NativeMlsBridge;

  constructor(bridge: NativeMlsBridge) {
    this.bridge = bridge;
  }

  generateKeyPackage(): Promise<Uint8Array> {
    return this.bridge.generateKeyPackage();
  }

  createGroup(groupId: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    return this.bridge.createGroup(groupId, keyPackage);
  }

  joinFromWelcome(welcome: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    return this.bridge.joinFromWelcome(welcome, keyPackage);
  }

  addMembers(keyPackages: readonly Uint8Array[]): Promise<AddMembersResult> {
    return this.bridge.addMembers(keyPackages);
  }

  removeMembers(leafIndexes: readonly number[]): Promise<Uint8Array> {
    return this.bridge.removeMembers(leafIndexes);
  }

  processCommit(commit: Uint8Array): Promise<void> {
    return this.bridge.processCommit(commit);
  }

  encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    return this.bridge.encrypt(plaintext);
  }

  decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    return this.bridge.decrypt(ciphertext);
  }

  epoch(): Promise<bigint> {
    return this.bridge.epoch();
  }

  members(): Promise<readonly MlsMember[]> {
    return this.bridge.members();
  }

  exportState(): Promise<Uint8Array> {
    return this.bridge.exportState();
  }

  importState(state: Uint8Array): Promise<void> {
    return this.bridge.importState(state);
  }
}

export interface NativeMlsEngineOptions {
  /**
   * The OpenMLS-backed bridge. Omit only to receive the typed
   * `not-implemented` error that documents the Phase 4 macOS build.
   */
  readonly bridge?: NativeMlsBridge;
}

/**
 * Creates the iOS/Android MLS engine over an OpenMLS bridge. Without a bridge
 * this throws a typed `not-implemented` error (see {@link NATIVE_MLS_TODO})
 * rather than falling back to an engine that cannot encrypt.
 */
export function createNativeMlsEngine(options: NativeMlsEngineOptions = {}): MlsEngine {
  if (!options.bridge) {
    throw new MlsEngineError("not-implemented", NATIVE_MLS_TODO);
  }
  return new OpenMlsEngine(options.bridge);
}
