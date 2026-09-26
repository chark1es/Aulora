/**
 * History-key sharing.
 *
 * MLS gives forward secrecy, which means a device that joins a channel *after*
 * a message was sent cannot read that older ciphertext. To let a new device or
 * a newly added member see past messages, an existing device that still holds
 * the channel's **history key** seals it to the newcomer's X25519 public key.
 * The server relays the resulting opaque envelope and can never open it.
 *
 * The scheme is a standard ephemeral-static ECDH box:
 *
 * 1. Sender generates an ephemeral X25519 key pair.
 * 2. Shared secret = X25519(ephemeral private, recipient public).
 * 3. Key = HKDF-SHA256(shared, salt = ephemeral‖recipient public, info).
 * 4. AES-256-GCM over the JSON list of `{ channelId, key, fromEpoch? }`.
 *
 * Because it is pure JS (`@noble/curves`, `@noble/hashes`, `@noble/ciphers`)
 * the same code runs on web, Tauri and Hermes. The *transport* (which device
 * publishes which envelope, and fetching archives) lives in Convex.
 */

import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  pack,
  unpack,
  utf8Decode,
  utf8Encode,
} from "./binary.js";
import { MlsEngineError } from "./errors.js";
import type { KeyStore } from "./keystore.js";

const SHARING_IDENTITY_RECORD = "aulora/mls/sharing";
const ENVELOPE_PREFIX = "aulora-history-v1.";
const HKDF_INFO = utf8Encode("aulora/history-key-share/v1");
const NONCE_BYTES = 12;
const PAYLOAD_VERSION = 1;

const X25519_PUBLIC_BYTES = 32;

/** This device's long-term X25519 key pair for receiving history bundles. */
export interface SharingIdentity {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

/** Generates a fresh X25519 sharing key pair. */
export function createSharingIdentity(): SharingIdentity {
  const { secretKey, publicKey } = x25519.keygen();
  return { publicKey, privateKey: secretKey };
}

/** Reads this install's sharing key pair, or `undefined`. */
export async function readSharingIdentity(
  keyStore: KeyStore,
): Promise<SharingIdentity | undefined> {
  const record = await keyStore.get(SHARING_IDENTITY_RECORD);
  if (!record) {
    return undefined;
  }
  const parts = unpack(record, 2);
  return { publicKey: requirePart(parts, 0), privateKey: requirePart(parts, 1) };
}

/** Persists the sharing key pair, encrypted through `keyStore`. */
export async function writeSharingIdentity(
  keyStore: KeyStore,
  identity: SharingIdentity,
): Promise<void> {
  await keyStore.set(SHARING_IDENTITY_RECORD, pack([identity.publicKey, identity.privateKey]));
}

/** Loads the sharing key pair, creating and persisting one on first use. */
export async function ensureSharingIdentity(keyStore: KeyStore): Promise<SharingIdentity> {
  const stored = await readSharingIdentity(keyStore);
  if (stored) {
    return stored;
  }
  const identity = createSharingIdentity();
  await writeSharingIdentity(keyStore, identity);
  return identity;
}

/** A channel history key sealed for one recipient device. */
export interface HistoryKeyShare {
  readonly channelId: string;
  readonly key: Uint8Array;
  readonly fromEpoch?: number;
}

function encodeShares(shares: readonly HistoryKeyShare[]): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      v: PAYLOAD_VERSION,
      shares: shares.map((share) => ({
        channelId: share.channelId,
        key: bytesToBase64Url(share.key),
        ...(share.fromEpoch !== undefined ? { fromEpoch: share.fromEpoch } : {}),
      })),
    }),
  );
}

function decodeShares(bytes: Uint8Array): HistoryKeyShare[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new MlsEngineError("decode", "history bundle payload is not valid JSON");
  }
  const record = parsed as { v?: unknown; shares?: unknown };
  if (record.v !== PAYLOAD_VERSION || !Array.isArray(record.shares)) {
    throw new MlsEngineError("decode", "history bundle has an unsupported shape");
  }
  const shares: HistoryKeyShare[] = [];
  for (const entry of record.shares) {
    const item = entry as { channelId?: unknown; key?: unknown; fromEpoch?: unknown };
    if (typeof item.channelId !== "string" || typeof item.key !== "string") {
      throw new MlsEngineError("decode", "history bundle entry is malformed");
    }
    shares.push({
      channelId: item.channelId,
      key: base64UrlToBytes(item.key),
      ...(typeof item.fromEpoch === "number" ? { fromEpoch: item.fromEpoch } : {}),
    });
  }
  return shares;
}

export interface SealHistoryKeysOptions {
  /** Recipient device's X25519 public key (from its `devices.sharingKey`). */
  readonly recipientPublicKey: Uint8Array;
  readonly shares: readonly HistoryKeyShare[];
  /** Crypto RNG override; defaults to the global. */
  readonly crypto?: Crypto;
}

/**
 * Seals one or more channel history keys to a recipient device and returns the
 * opaque envelope string the server relays.
 */
export function sealHistoryKeys(options: SealHistoryKeysOptions): string {
  const crypto = options.crypto ?? globalThis.crypto;
  if (options.recipientPublicKey.length !== X25519_PUBLIC_BYTES) {
    throw new MlsEngineError("decode", "recipient history key must be 32 bytes");
  }
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, options.recipientPublicKey);
  const key = hkdf(
    sha256,
    shared,
    concatBytes([ephemeral.publicKey, options.recipientPublicKey]),
    HKDF_INFO,
    32,
  );
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = gcm(key, nonce, utf8Encode("aulora-history-share-v1")).encrypt(
    encodeShares(options.shares),
  );
  const body = concatBytes([ephemeral.publicKey, nonce, ciphertext]);
  return ENVELOPE_PREFIX + bytesToBase64Url(body);
}

export interface OpenHistoryKeysOptions {
  /** The opaque envelope produced by {@link sealHistoryKeys}. */
  readonly envelope: string;
  /** This device's X25519 private key. */
  readonly recipientPrivateKey: Uint8Array;
}

/** Opens a history bundle addressed to this device's sharing key. */
export function openHistoryKeys(options: OpenHistoryKeysOptions): HistoryKeyShare[] {
  if (!options.envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new MlsEngineError("decode", "history bundle has an unknown envelope version");
  }
  let raw: Uint8Array;
  try {
    raw = base64UrlToBytes(options.envelope.slice(ENVELOPE_PREFIX.length));
  } catch {
    throw new MlsEngineError("decode", "history bundle is not valid base64url");
  }
  if (raw.length <= X25519_PUBLIC_BYTES + NONCE_BYTES) {
    throw new MlsEngineError("decode", "history bundle is truncated");
  }
  const ephemeralPublicKey = raw.slice(0, X25519_PUBLIC_BYTES);
  const nonce = raw.slice(X25519_PUBLIC_BYTES, X25519_PUBLIC_BYTES + NONCE_BYTES);
  const ciphertext = raw.slice(X25519_PUBLIC_BYTES + NONCE_BYTES);
  const shared = x25519.getSharedSecret(options.recipientPrivateKey, ephemeralPublicKey);
  const key = hkdf(
    sha256,
    shared,
    concatBytes([ephemeralPublicKey, x25519.getPublicKey(options.recipientPrivateKey)]),
    HKDF_INFO,
    32,
  );
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, nonce, utf8Encode("aulora-history-share-v1")).decrypt(ciphertext);
  } catch {
    throw new MlsEngineError(
      "decode",
      "could not open history bundle: wrong recipient or tampered",
    );
  }
  return decodeShares(plaintext);
}

/** Public half of this device's sharing identity, as stored on `devices`. */
export function sharingPublicKeyBase64(identity: SharingIdentity): string {
  return bytesToBase64Url(identity.publicKey);
}

function requirePart(parts: readonly Uint8Array[], index: number): Uint8Array {
  const part = parts[index];
  if (!part) {
    throw new MlsEngineError("decode", "malformed sharing key record");
  }
  return part;
}
