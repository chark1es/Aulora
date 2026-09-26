/**
 * Recovery-passphrase key backup.
 *
 * A user's identity key and per-channel history keys are encrypted under a key
 * derived from a passphrase with **Argon2id** (the KDF named in `plan.md`).
 * The opaque blob and its KDF parameters are stored server-side in
 * `keyBackups`; the server can neither derive the key nor read the payload.
 *
 * Why Argon2id and not PBKDF2: it is memory-hard, so an attacker with GPUs
 * gains far less per guess, and it is the current password-hashing
 * recommendation (RFC 9106). Defaults are 64 MiB / 3 iterations; callers may
 * lower them for tests only.
 *
 * Everything is pure JS (`@noble/hashes`, `@noble/ciphers`), so the same code
 * restores a backup on web, Tauri and Hermes. Deriving the key blocks the
 * calling thread by design; run it in a worker/JSI task on a real client.
 */

import { gcm } from "@noble/ciphers/aes.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from "./binary.js";
import { MlsEngineError } from "./errors.js";

/** Argon2id parameters as persisted in `keyBackups.kdfParams` (JSON). */
export interface Argon2idParams {
  readonly algorithm: "argon2id";
  /** Base64url-encoded random salt. */
  readonly salt: string;
  /** Iterations (time cost). */
  readonly t: number;
  /** Memory cost in kibibytes. */
  readonly m: number;
  /** Parallelism. */
  readonly p: number;
  /** Derived-key length in bytes. */
  readonly dkLen: number;
  /** Argon2 version; `0x13` is RFC 9106. */
  readonly version: number;
}

/** Tunable part of {@link Argon2idParams}; a fresh salt is always generated. */
export interface Argon2idCost {
  readonly t: number;
  readonly m: number;
  readonly p: number;
  readonly dkLen: number;
  readonly version: number;
}

/** Production defaults: 64 MiB, 3 iterations, single lane, 32-byte key. */
export const DEFAULT_ARGON2ID_COST: Argon2idCost = {
  t: 3,
  m: 65_536,
  p: 1,
  dkLen: 32,
  version: 0x13,
};

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const BACKUP_PREFIX = "aulora-backup-v1.";
const BACKUP_AAD = utf8Encode("aulora-key-backup-v1");
const PAYLOAD_VERSION = 1;

/** Refuse absurd KDF parameters so a hostile row cannot exhaust the client. */
const MAX_T = 10;
const MAX_M = 1 << 20;
const MAX_P = 4;

export function validateArgon2idParams(params: Argon2idParams): void {
  let salt: Uint8Array;
  try {
    salt = base64UrlToBytes(params.salt);
  } catch {
    throw new MlsEngineError("decode", "key backup salt is not valid base64url");
  }
  if (
    params.algorithm !== "argon2id" ||
    salt.length < 8 ||
    !Number.isInteger(params.t) ||
    params.t < 1 ||
    params.t > MAX_T ||
    !Number.isInteger(params.m) ||
    params.m < 8 ||
    params.m > MAX_M ||
    !Number.isInteger(params.p) ||
    params.p < 1 ||
    params.p > MAX_P ||
    !Number.isInteger(params.dkLen) ||
    params.dkLen < 16 ||
    params.dkLen > 64 ||
    params.version !== 0x13
  ) {
    throw new MlsEngineError("decode", "key backup KDF parameters are out of range");
  }
}

/** Derives the 32-byte backup key from a passphrase and stored parameters. */
export async function deriveBackupKey(
  passphrase: string,
  params: Argon2idParams,
): Promise<Uint8Array> {
  validateArgon2idParams(params);
  return await argon2idAsync(utf8Encode(passphrase), base64UrlToBytes(params.salt), {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dkLen,
    version: params.version,
  });
}

/** One channel's history key, included in a backup so history survives. */
export interface HistoryKeyRecord {
  readonly channelId: string;
  readonly key: Uint8Array;
  /** Epoch the key is valid from, when known. */
  readonly fromEpoch?: number;
}

/** The plaintext a recovery passphrase protects. */
export interface KeyBackupPayload {
  /** The serialized device identity record. */
  readonly identity: Uint8Array;
  /** Per-channel history keys. */
  readonly historyKeys: readonly HistoryKeyRecord[];
}

/** Serializes a backup payload to the bytes that are encrypted. */
export function encodeKeyBackupPayload(payload: KeyBackupPayload): Uint8Array {
  const history = payload.historyKeys.map((record) => ({
    channelId: record.channelId,
    key: bytesToBase64Url(record.key),
    ...(record.fromEpoch !== undefined ? { fromEpoch: record.fromEpoch } : {}),
  }));
  return utf8Encode(
    JSON.stringify({
      v: PAYLOAD_VERSION,
      identity: bytesToBase64Url(payload.identity),
      history,
    }),
  );
}

/** Inverse of {@link encodeKeyBackupPayload}. */
export function decodeKeyBackupPayload(bytes: Uint8Array): KeyBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new MlsEngineError("decode", "key backup payload is not valid JSON");
  }
  const record = parsed as { v?: unknown; identity?: unknown; history?: unknown };
  if (record.v !== PAYLOAD_VERSION || typeof record.identity !== "string") {
    throw new MlsEngineError("decode", "key backup payload has an unsupported shape");
  }
  const historyRaw = Array.isArray(record.history) ? record.history : [];
  const historyKeys: HistoryKeyRecord[] = [];
  try {
    for (const entry of historyRaw) {
      const item = entry as { channelId?: unknown; key?: unknown; fromEpoch?: unknown };
      if (typeof item.channelId !== "string" || typeof item.key !== "string") {
        throw new MlsEngineError("decode", "key backup history entry is malformed");
      }
      historyKeys.push({
        channelId: item.channelId,
        key: base64UrlToBytes(item.key),
        ...(typeof item.fromEpoch === "number" ? { fromEpoch: item.fromEpoch } : {}),
      });
    }
    return { identity: base64UrlToBytes(record.identity), historyKeys };
  } catch (error) {
    if (error instanceof MlsEngineError) {
      throw error;
    }
    throw new MlsEngineError("decode", "key backup payload contains invalid base64url");
  }
}

export interface CreateKeyBackupOptions {
  readonly passphrase: string;
  readonly payload: KeyBackupPayload;
  /** Override the KDF cost, mainly for tests. */
  readonly cost?: Partial<Argon2idCost>;
  /** Override the salt (tests only); defaults to 16 random bytes. */
  readonly salt?: Uint8Array;
  /** Crypto RNG override; defaults to the global. */
  readonly crypto?: Crypto;
}

export interface KeyBackup {
  /** Opaque ciphertext for `keyBackups.backupCiphertext`. */
  readonly backupCiphertext: string;
  /** JSON string for `keyBackups.kdfParams`. */
  readonly kdfParams: string;
}

/**
 * Encrypts a backup payload under a passphrase-derived key. A fresh salt and
 * nonce are generated on every call, so re-backing-up never reuses keystream.
 */
export async function createKeyBackup(options: CreateKeyBackupOptions): Promise<KeyBackup> {
  const crypto = options.crypto ?? globalThis.crypto;
  const cost: Argon2idCost = { ...DEFAULT_ARGON2ID_COST, ...options.cost };
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const params: Argon2idParams = {
    algorithm: "argon2id",
    salt: bytesToBase64Url(salt),
    ...cost,
  };
  const key = await deriveBackupKey(options.passphrase, params);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const plaintext = encodeKeyBackupPayload(options.payload);
  const ciphertext = gcm(key, nonce, BACKUP_AAD).encrypt(plaintext);
  return {
    backupCiphertext: BACKUP_PREFIX + bytesToBase64Url(concatBytes([nonce, ciphertext])),
    kdfParams: JSON.stringify(params),
  };
}

export interface OpenKeyBackupOptions {
  readonly passphrase: string;
  readonly backupCiphertext: string;
  /** JSON string from `keyBackups.kdfParams`. */
  readonly kdfParams: string;
}

/** Parses and validates the stored KDF parameter JSON. */
export function parseArgon2idParams(kdfParams: string): Argon2idParams {
  let parsed: unknown;
  try {
    parsed = JSON.parse(kdfParams);
  } catch {
    throw new MlsEngineError("decode", "key backup KDF parameters are not valid JSON");
  }
  const params = parsed as Argon2idParams;
  validateArgon2idParams(params);
  return params;
}

/**
 * Decrypts a backup with the recovery passphrase. Throws
 * {@link MlsEngineError} when the passphrase is wrong or the blob was tampered
 * with (AES-GCM authentication fails before any payload parsing).
 */
export async function openKeyBackup(options: OpenKeyBackupOptions): Promise<KeyBackupPayload> {
  if (!options.backupCiphertext.startsWith(BACKUP_PREFIX)) {
    throw new MlsEngineError("decode", "key backup has an unknown envelope version");
  }
  const params = parseArgon2idParams(options.kdfParams);
  let raw: Uint8Array;
  try {
    raw = base64UrlToBytes(options.backupCiphertext.slice(BACKUP_PREFIX.length));
  } catch {
    throw new MlsEngineError("decode", "key backup ciphertext is not valid base64url");
  }
  if (raw.length <= NONCE_BYTES) {
    throw new MlsEngineError("decode", "key backup ciphertext is truncated");
  }
  const nonce = raw.slice(0, NONCE_BYTES);
  const ciphertext = raw.slice(NONCE_BYTES);
  const key = await deriveBackupKey(options.passphrase, params);
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, nonce, BACKUP_AAD).decrypt(ciphertext);
  } catch {
    throw new MlsEngineError("decode", "could not open key backup: wrong passphrase or corrupted");
  }
  return decodeKeyBackupPayload(plaintext);
}
