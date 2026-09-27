/**
 * Small binary helpers shared by the client packages.
 *
 * These moved out of the former client-side crypto package so `@aulora/core`
 * no longer depends on it. They are pure and dependency-free.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Standard base64 for small blobs (keys, IVs, hashes). Not for large files. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Inverse of {@link bytesToBase64}. */
export function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * URL-safe base64 without padding (RFC 4648 §5). Used for QR payloads and
 * opaque envelopes, which may travel through URLs or query strings.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of {@link bytesToBase64Url}; accepts padded or unpadded input. */
export function base64UrlToBytes(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(padded);
}

/** Concatenate byte parts verbatim (no length prefixes). */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) {
    size += part.length;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Length-independent equality, for comparing fingerprints and KDF outputs. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}
