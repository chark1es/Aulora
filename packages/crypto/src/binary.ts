/**
 * Small binary helpers shared by the engine and the key store.
 *
 * Records written to a {@link KeyStore} are packed as a sequence of
 * length-prefixed byte parts (4-byte big-endian length) so a single store
 * write is atomic and adapters only ever deal with opaque bytes.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
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

/** Concatenate parts as `[length][bytes]...` with 4-byte big-endian lengths. */
export function pack(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) {
    size += 4 + part.length;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length);
    offset += 4;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Inverse of {@link pack}; returns exactly `count` parts or throws. */
export function unpack(bytes: Uint8Array, count: number): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > bytes.length) {
      throw new RangeError("malformed packed record");
    }
    const length = view.getUint32(offset);
    offset += 4;
    if (offset + length > bytes.length) {
      throw new RangeError("malformed packed record");
    }
    parts.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return parts;
}
