/**
 * Web/desktop MLS engine backed by `ts-mls@1.6.4`.
 *
 * This is the only module that may import ts-mls. It follows the installed
 * 1.6.4 type declarations (not the README): positional-argument functions, and
 * `decodeMlsMessage(bytes, offset)` returning `[value, bytesConsumed]`.
 *
 * Device identity: a stable Ed25519 signature key pair is generated once and
 * persisted (encrypted) in the {@link KeyStore}. Each `generateKeyPackage()`
 * binds that identity to a fresh HPKE/init key and stores the private package
 * for single use by `createGroup` / `joinFromWelcome`.
 */

import type {
  CiphersuiteImpl,
  CiphersuiteName,
  ClientState,
  KeyPackage,
  MLSMessage,
  PrivateKeyPackage,
  Proposal,
} from "ts-mls";
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  processPrivateMessage,
  processPublicMessage,
  zeroOutUint8Array,
} from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { bytesToHex, pack, unpack, utf8Decode, utf8Encode } from "./binary.js";
import type { AddMembersResult, MlsEngine, MlsMember } from "./engine.js";
import { MlsEngineError } from "./errors.js";
import type { KeyStore } from "./keystore.js";

/** The verified Aulora ciphersuite from the Phase 0 spike. */
export const AULORA_CIPHER_SUITE: CiphersuiteName = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";

const IDENTITY_RECORD = "aulora/mls/identity";
const KEY_PACKAGE_PREFIX = "aulora/mls/keypackage/";
const GROUP_PREFIX = "aulora/mls/group/";

/** Stable device identity; the signature key pair is the MLS credential key. */
export interface DeviceIdentity {
  /** Random stable device id (hex). */
  readonly deviceId: string;
  /** Basic credential identity presented to other members. */
  readonly credentialIdentity: Uint8Array;
  /** Ed25519 public key bound to the credential. */
  readonly signaturePublicKey: Uint8Array;
  /** Ed25519 private key; stored encrypted, never logged or exported. */
  readonly signaturePrivateKey: Uint8Array;
}

export interface WebMlsEngineOptions {
  /** Encrypted key store for identity, KeyPackages and group state. */
  readonly keyStore: KeyStore;
  /** Override the device identity instead of generating one. */
  readonly identity?: DeviceIdentity;
  /** Ciphersuite; defaults to {@link AULORA_CIPHER_SUITE}. */
  readonly cipherSuite?: CiphersuiteName;
  /** Crypto implementation; defaults to the global. */
  readonly crypto?: Crypto;
}

class WebMlsEngine implements MlsEngine {
  private readonly keyStore: KeyStore;
  private readonly cryptoImpl: Crypto;
  private readonly cipherSuiteName: CiphersuiteName;
  private readonly identityOverride: DeviceIdentity | undefined;
  private cipherSuitePromise: Promise<CiphersuiteImpl> | undefined;
  private identityPromise: Promise<DeviceIdentity> | undefined;
  private activeState: ClientState | undefined;
  private activeGroupKey: string | undefined;

  constructor(options: WebMlsEngineOptions) {
    this.keyStore = options.keyStore;
    this.cryptoImpl = options.crypto ?? globalThis.crypto;
    this.cipherSuiteName = options.cipherSuite ?? AULORA_CIPHER_SUITE;
    this.identityOverride = options.identity;
  }

  private cipherSuite(): Promise<CiphersuiteImpl> {
    this.cipherSuitePromise ??= getCiphersuiteImpl(getCiphersuiteFromName(this.cipherSuiteName));
    return this.cipherSuitePromise;
  }

  private identity(): Promise<DeviceIdentity> {
    this.identityPromise ??= this.loadOrCreateIdentity();
    return this.identityPromise;
  }

  private async loadOrCreateIdentity(): Promise<DeviceIdentity> {
    if (this.identityOverride) {
      await this.persistIdentity(this.identityOverride);
      return this.identityOverride;
    }
    const stored = await this.readIdentity();
    if (stored) {
      return stored;
    }
    const cipherSuite = await this.cipherSuite();
    const keyPair = await cipherSuite.signature.keygen();
    const deviceId = bytesToHex(this.cryptoImpl.getRandomValues(new Uint8Array(16)));
    const identity: DeviceIdentity = {
      deviceId,
      credentialIdentity: utf8Encode(`aulora:device:${deviceId}`),
      signaturePublicKey: keyPair.publicKey,
      signaturePrivateKey: keyPair.signKey,
    };
    await this.persistIdentity(identity);
    return identity;
  }

  private readIdentity(): Promise<DeviceIdentity | undefined> {
    return readDeviceIdentity(this.keyStore);
  }

  private persistIdentity(identity: DeviceIdentity): Promise<void> {
    return writeDeviceIdentity(this.keyStore, identity);
  }

  async generateKeyPackage(): Promise<Uint8Array> {
    const [identity, cipherSuite] = await Promise.all([this.identity(), this.cipherSuite()]);
    const bundle = await generateKeyPackageWithKey(
      { credentialType: "basic", identity: identity.credentialIdentity },
      defaultCapabilities(),
      defaultLifetime,
      [],
      { signKey: identity.signaturePrivateKey, publicKey: identity.signaturePublicKey },
      cipherSuite,
    );
    const encoded = encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_key_package",
      keyPackage: bundle.publicPackage,
    });
    const reference = await this.keyPackageReference(encoded, cipherSuite);
    await this.keyStore.set(
      `${KEY_PACKAGE_PREFIX}${reference}`,
      pack([
        identity.credentialIdentity,
        bundle.privatePackage.initPrivateKey,
        bundle.privatePackage.hpkePrivateKey,
        bundle.privatePackage.signaturePrivateKey,
      ]),
    );
    return encoded;
  }

  async createGroup(groupId: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    const [publicPackage, privatePackage, cipherSuite] = await Promise.all([
      Promise.resolve(decodeKeyPackageMessage(keyPackage)),
      this.consumeKeyPackage(keyPackage),
      this.cipherSuite(),
    ]);
    const state = await createGroup(groupId, publicPackage, privatePackage, [], cipherSuite);
    await this.activate(state);
  }

  async joinFromWelcome(welcome: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    const welcomeMessage = decodeWelcomeMessage(welcome);
    const [publicPackage, privatePackage, cipherSuite] = await Promise.all([
      Promise.resolve(decodeKeyPackageMessage(keyPackage)),
      this.consumeKeyPackage(keyPackage),
      this.cipherSuite(),
    ]);
    const state = await joinGroup(
      welcomeMessage,
      publicPackage,
      privatePackage,
      emptyPskIndex,
      cipherSuite,
    );
    await this.activate(state);
  }

  async addMembers(keyPackages: readonly Uint8Array[]): Promise<AddMembersResult> {
    const state = this.requireActive();
    const cipherSuite = await this.cipherSuite();
    const proposals: Proposal[] = keyPackages.map((keyPackage) => ({
      proposalType: "add",
      add: { keyPackage: decodeKeyPackageMessage(keyPackage) },
    }));
    const result = await createCommit(
      { state, cipherSuite },
      { extraProposals: proposals, ratchetTreeExtension: true },
    );
    if (!result.welcome) {
      throw new MlsEngineError("welcome-missing", "add commit did not produce a MLS welcome");
    }
    const commit = encodeMlsMessage(result.commit);
    const welcome = encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_welcome",
      welcome: result.welcome,
    });
    await this.activate(result.newState);
    result.consumed.forEach(zeroOutUint8Array);
    return { commit, welcome };
  }

  async removeMembers(leafIndexes: readonly number[]): Promise<Uint8Array> {
    if (leafIndexes.length === 0) {
      throw new MlsEngineError("decode", "removeMembers requires at least one leaf index");
    }
    const state = this.requireActive();
    const cipherSuite = await this.cipherSuite();
    const proposals: Proposal[] = leafIndexes.map((removed) => ({
      proposalType: "remove",
      remove: { removed },
    }));
    const result = await createCommit(
      { state, cipherSuite },
      { extraProposals: proposals, wireAsPublicMessage: true },
    );
    const commit = encodeMlsMessage(result.commit);
    await this.activate(result.newState);
    result.consumed.forEach(zeroOutUint8Array);
    return commit;
  }

  async processCommit(commit: Uint8Array): Promise<void> {
    const state = this.requireActive();
    const cipherSuite = await this.cipherSuite();
    const message = decodeMessage(commit);
    if (message.wireformat === "mls_public_message") {
      const result = await processPublicMessage(
        state,
        message.publicMessage,
        emptyPskIndex,
        cipherSuite,
        acceptAll,
      );
      await this.activate(result.newState);
      result.consumed.forEach(zeroOutUint8Array);
      return;
    }
    if (message.wireformat === "mls_private_message") {
      const result = await processPrivateMessage(
        state,
        message.privateMessage,
        emptyPskIndex,
        cipherSuite,
        acceptAll,
      );
      if (result.kind !== "newState") {
        result.consumed.forEach(zeroOutUint8Array);
        throw new MlsEngineError(
          "unsupported-message",
          "expected a handshake commit but received an application message",
        );
      }
      await this.activate(result.newState);
      result.consumed.forEach(zeroOutUint8Array);
      return;
    }
    throw new MlsEngineError(
      "unsupported-message",
      `unsupported wire format: ${message.wireformat}`,
    );
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const state = this.requireActive();
    const cipherSuite = await this.cipherSuite();
    const result = await createApplicationMessage(state, plaintext, cipherSuite);
    const encoded = encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_private_message",
      privateMessage: result.privateMessage,
    });
    await this.activate(result.newState);
    result.consumed.forEach(zeroOutUint8Array);
    return encoded;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const state = this.requireActive();
    const cipherSuite = await this.cipherSuite();
    const message = decodeMessage(ciphertext);
    if (message.wireformat !== "mls_private_message") {
      throw new MlsEngineError("not-application-message", "MLS message is not a private message");
    }
    const result = await processPrivateMessage(
      state,
      message.privateMessage,
      emptyPskIndex,
      cipherSuite,
      acceptAll,
    );
    if (result.kind !== "applicationMessage") {
      result.consumed.forEach(zeroOutUint8Array);
      throw new MlsEngineError(
        "not-application-message",
        "MLS message was a handshake message, not an application message",
      );
    }
    const plaintext = result.message;
    await this.activate(result.newState);
    result.consumed.forEach(zeroOutUint8Array);
    return plaintext;
  }

  async epoch(): Promise<bigint> {
    return this.requireActive().groupContext.epoch;
  }

  async members(): Promise<readonly MlsMember[]> {
    const state = this.requireActive();
    const members: MlsMember[] = [];
    for (let leafIndex = 0; leafIndex * 2 < state.ratchetTree.length; leafIndex += 1) {
      const node = state.ratchetTree[leafIndex * 2];
      if (node?.nodeType !== "leaf") {
        continue;
      }
      const credential = node.leaf.credential;
      if (credential.credentialType !== "basic") {
        continue;
      }
      members.push({ leafIndex, identity: utf8Decode(credential.identity) });
    }
    return members;
  }

  async exportState(): Promise<Uint8Array> {
    return encodeGroupState(this.requireActive());
  }

  async importState(state: Uint8Array): Promise<void> {
    const decoded = decodeGroupState(state, 0);
    if (!decoded) {
      throw new MlsEngineError("decode", "could not decode MLS group state");
    }
    const [groupState] = decoded;
    await this.activate({ ...groupState, clientConfig: defaultClientConfig });
  }

  private async keyPackageReference(
    encoded: Uint8Array,
    cipherSuite: CiphersuiteImpl,
  ): Promise<string> {
    return bytesToHex(await cipherSuite.hash.digest(encoded));
  }

  private async consumeKeyPackage(encoded: Uint8Array): Promise<PrivateKeyPackage> {
    const reference = await this.keyPackageReference(encoded, await this.cipherSuite());
    const key = `${KEY_PACKAGE_PREFIX}${reference}`;
    const record = await this.keyStore.get(key);
    const parts = record ? unpack(record, 4) : undefined;
    if (!parts) {
      throw new MlsEngineError(
        "unknown-key-package",
        "no private material found for this KeyPackage; generate a new one",
      );
    }
    // KeyPackages are single-use: consume the private material immediately.
    await this.keyStore.delete(key);
    return {
      initPrivateKey: requirePart(parts, 1),
      hpkePrivateKey: requirePart(parts, 2),
      signaturePrivateKey: requirePart(parts, 3),
    };
  }

  private activate(state: ClientState): Promise<void> {
    this.activeState = state;
    this.activeGroupKey = `${GROUP_PREFIX}${bytesToHex(state.groupContext.groupId)}`;
    return this.persistActive();
  }

  private async persistActive(): Promise<void> {
    const state = this.requireActive();
    if (!this.activeGroupKey) {
      throw new MlsEngineError("no-active-group", "cannot persist without an active group");
    }
    await this.keyStore.set(this.activeGroupKey, encodeGroupState(state));
  }

  private requireActive(): ClientState {
    if (!this.activeState) {
      throw new MlsEngineError("no-active-group", "no active MLS group; create or join one first");
    }
    return this.activeState;
  }
}

/** Create the web/desktop MLS engine. See {@link MlsEngine}. */
export function createWebMlsEngine(options: WebMlsEngineOptions): MlsEngine {
  return new WebMlsEngine(options);
}

/**
 * Reads the persisted device identity (public and private parts), or
 * `undefined` when this install has not created one yet. Exposed so callers
 * can register the public identity with the server without touching ts-mls.
 */
export async function readDeviceIdentity(keyStore: KeyStore): Promise<DeviceIdentity | undefined> {
  const record = await keyStore.get(IDENTITY_RECORD);
  if (!record) {
    return undefined;
  }
  const parts = unpack(record, 4);
  return {
    deviceId: utf8Decode(requirePart(parts, 0)),
    credentialIdentity: requirePart(parts, 1),
    signaturePublicKey: requirePart(parts, 2),
    signaturePrivateKey: requirePart(parts, 3),
  };
}

/** Persists the device identity record encrypted through `keyStore`. */
export async function writeDeviceIdentity(
  keyStore: KeyStore,
  identity: DeviceIdentity,
): Promise<void> {
  await keyStore.set(
    IDENTITY_RECORD,
    pack([
      utf8Encode(identity.deviceId),
      identity.credentialIdentity,
      identity.signaturePublicKey,
      identity.signaturePrivateKey,
    ]),
  );
}

/**
 * Loads this install's MLS device identity, creating and persisting one on
 * first use. The Ed25519 key pair is generated once per install and is the
 * credential bound to every KeyPackage. Call this on the main thread before
 * spawning Worker engines so every engine shares one identity record.
 */
export async function ensureDeviceIdentity(
  keyStore: KeyStore,
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<DeviceIdentity> {
  const stored = await readDeviceIdentity(keyStore);
  if (stored) {
    return stored;
  }
  const cipherSuite = await getCiphersuiteImpl(getCiphersuiteFromName(AULORA_CIPHER_SUITE));
  const keyPair = await cipherSuite.signature.keygen();
  const deviceId = bytesToHex(cryptoImpl.getRandomValues(new Uint8Array(16)));
  const identity: DeviceIdentity = {
    deviceId,
    credentialIdentity: utf8Encode(`aulora:device:${deviceId}`),
    signaturePublicKey: keyPair.publicKey,
    signaturePrivateKey: keyPair.signKey,
  };
  await writeDeviceIdentity(keyStore, identity);
  return identity;
}

function decodeMessage(bytes: Uint8Array): MLSMessage {
  const decoded = decodeMlsMessage(bytes, 0);
  if (!decoded) {
    throw new MlsEngineError("decode", "could not decode MLS message");
  }
  return decoded[0];
}

function decodeKeyPackageMessage(bytes: Uint8Array): KeyPackage {
  const message = decodeMessage(bytes);
  if (message.wireformat !== "mls_key_package") {
    throw new MlsEngineError("decode", "MLS message is not a KeyPackage");
  }
  return message.keyPackage;
}

function decodeWelcomeMessage(bytes: Uint8Array) {
  const message = decodeMessage(bytes);
  if (message.wireformat !== "mls_welcome") {
    throw new MlsEngineError("decode", "MLS message is not a Welcome");
  }
  return message.welcome;
}

function requirePart(parts: readonly Uint8Array[], index: number): Uint8Array {
  const part = parts[index];
  if (!part) {
    throw new MlsEngineError("decode", "malformed key store record");
  }
  return part;
}
