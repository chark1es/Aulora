/**
 * Per-file symmetric encryption for attachments.
 *
 * Every upload gets a fresh random AES-GCM key + IV. The ciphertext bytes go
 * to Convex storage; the key, IV and plaintext metadata travel **inside an MLS
 * application payload** as an {@link AttachmentDescriptor}, so the server only
 * ever holds ciphertext and opaque ids. The engine never logs any of this.
 */

import { base64ToBytes, bytesToBase64 } from "./binary.js";

/** AES-GCM key length for attachment objects. */
export const ATTACHMENT_KEY_BYTES = 32;
/** AES-GCM IV length for attachment objects. */
export const ATTACHMENT_IV_BYTES = 12;

export interface AttachmentDimensions {
  readonly width: number;
  readonly height: number;
}

/** One encrypted blob (full file or its thumbnail) in Convex storage. */
export interface EncryptedObjectRef {
  readonly fileId: string;
  /** Base64 AES-GCM key. Never sent to the server. */
  readonly key: string;
  /** Base64 AES-GCM IV. Never sent to the server. */
  readonly iv: string;
}

/**
 * Opaque attachment descriptor carried inside the MLS-encrypted message. The
 * server sees only `fileId` (via `messages.attachmentIds`); `key` and `iv` are
 * unreadable to it.
 */
export interface AttachmentDescriptor extends EncryptedObjectRef {
  readonly mime: string;
  readonly name: string;
  /** Ciphertext byte length, as recorded server-side. */
  readonly size: number;
  readonly dimensions?: AttachmentDimensions;
  /** Blurhash placeholder for progressive image display. */
  readonly blurhash?: string;
  /** Encrypted small thumbnail, for images; the UI shows this before the full blob. */
  readonly thumbnail?: EncryptedObjectRef & {
    readonly width: number;
    readonly height: number;
    readonly blurhash?: string;
  };
}

export interface AttachmentCryptoOptions {
  /** Crypto implementation; defaults to the global WebCrypto. Injectable for tests. */
  readonly crypto?: Crypto;
}

function resolveCrypto(options: AttachmentCryptoOptions = {}): Crypto {
  const crypto = options.crypto ?? globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error("@aulora/crypto: WebCrypto is not available in this environment");
  }
  return crypto;
}

/** Bridges TS 5.9's generic `Uint8Array` to the DOM `BufferSource` overloads. */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function importKey(crypto: Crypto, keyBase64: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(keyBase64);
  if (keyBytes.length !== ATTACHMENT_KEY_BYTES) {
    throw new Error("@aulora/crypto: invalid attachment key length");
  }
  return await crypto.subtle.importKey("raw", asBufferSource(keyBytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function assertIv(ivBase64: string): BufferSource {
  const iv = base64ToBytes(ivBase64);
  if (iv.length !== ATTACHMENT_IV_BYTES) {
    throw new Error("@aulora/crypto: invalid attachment iv length");
  }
  return asBufferSource(iv);
}

/** Generates a fresh random AES-GCM key + IV for one attachment. */
export function generateAttachmentKey(options: AttachmentCryptoOptions = {}): {
  key: string;
  iv: string;
} {
  const crypto = resolveCrypto(options);
  const key = new Uint8Array(ATTACHMENT_KEY_BYTES);
  const iv = new Uint8Array(ATTACHMENT_IV_BYTES);
  crypto.getRandomValues(key);
  crypto.getRandomValues(iv);
  return { key: bytesToBase64(key), iv: bytesToBase64(iv) };
}

/** Encrypts bytes with an existing key/IV. */
export async function encryptAttachmentBytes(
  bytes: Uint8Array,
  key: string,
  iv: string,
  options: AttachmentCryptoOptions = {},
): Promise<Uint8Array> {
  const crypto = resolveCrypto(options);
  const cryptoKey = await importKey(crypto, key);
  const buffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: assertIv(iv) },
    cryptoKey,
    asBufferSource(bytes),
  );
  return new Uint8Array(buffer);
}

/** Decrypts bytes with the descriptor's key/IV. Throws on tampering. */
export async function decryptAttachmentBytes(
  ciphertext: Uint8Array,
  key: string,
  iv: string,
  options: AttachmentCryptoOptions = {},
): Promise<Uint8Array> {
  const crypto = resolveCrypto(options);
  const cryptoKey = await importKey(crypto, key);
  const buffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: assertIv(iv) },
    cryptoKey,
    asBufferSource(ciphertext),
  );
  return new Uint8Array(buffer);
}

/** Encrypts bytes with a fresh key/IV, returning the ciphertext and the key envelope. */
export async function sealAttachmentBytes(
  bytes: Uint8Array,
  options: AttachmentCryptoOptions = {},
): Promise<{ ciphertext: Uint8Array; key: string; iv: string }> {
  const { key, iv } = generateAttachmentKey(options);
  const ciphertext = await encryptAttachmentBytes(bytes, key, iv, options);
  return { ciphertext, key, iv };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDimensions(value: unknown): AttachmentDimensions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const width = value.width;
  const height = value.height;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

function parseObjectRef(value: unknown): EncryptedObjectRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = readString(value.fileId);
  const key = readString(value.key);
  const iv = readString(value.iv);
  if (fileId === null || key === null || iv === null) {
    return null;
  }
  try {
    if (base64ToBytes(key).length !== ATTACHMENT_KEY_BYTES) {
      return null;
    }
    if (base64ToBytes(iv).length !== ATTACHMENT_IV_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return { fileId, key, iv };
}

/**
 * Validates an untrusted descriptor decoded from a message payload. Returns
 * `null` (never throws) when the shape, key or IV is wrong, so a hostile payload
 * can never make the UI fetch or decrypt something nonsensical.
 */
export function parseAttachmentDescriptor(value: unknown): AttachmentDescriptor | null {
  const ref = parseObjectRef(value);
  if (ref === null || !isRecord(value)) {
    return null;
  }
  const mime = readString(value.mime);
  const name = readString(value.name);
  const size = typeof value.size === "number" && value.size >= 0 ? value.size : null;
  if (mime === null || name === null || size === null) {
    return null;
  }
  const dimensions = parseDimensions(value.dimensions);
  const blurhash = readString(value.blurhash);
  const thumbnailRef = parseObjectRef(value.thumbnail);
  let thumbnail: AttachmentDescriptor["thumbnail"] | undefined;
  if (thumbnailRef !== null && isRecord(value.thumbnail)) {
    const width = value.thumbnail.width;
    const height = value.thumbnail.height;
    if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
      const thumbnailBlurhash = readString(value.thumbnail.blurhash);
      thumbnail = {
        ...thumbnailRef,
        width,
        height,
        ...(thumbnailBlurhash !== null ? { blurhash: thumbnailBlurhash } : {}),
      };
    }
  }
  return {
    ...ref,
    mime,
    name,
    size,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(blurhash !== null ? { blurhash } : {}),
    ...(thumbnail !== undefined ? { thumbnail } : {}),
  };
}
