/**
 * Wire encoding for MLS payloads.
 *
 * The server stores ciphertext as a string and never parses it, so every MLS
 * blob (KeyPackage, commit, welcome, application message) crosses the boundary
 * as base64. Plaintext never touches the server; only these opaque strings do.
 */

import { utf8Decode, utf8Encode } from "@aulora/crypto";

/** Base64-encodes raw MLS bytes for storage. */
export function encodeMlsBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decodes a base64 MLS blob back to bytes. */
export function decodeMlsBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Encodes an application payload (JSON) as bytes for `engine.encrypt`. */
export function encodePayload(payload: unknown): Uint8Array {
  return utf8Encode(JSON.stringify(payload));
}

/** Decodes decrypted application bytes back into the payload JSON. */
export function decodePayload<T>(bytes: Uint8Array): T {
  return JSON.parse(utf8Decode(bytes)) as T;
}

/**
 * Builds the stable MLS group identifier for a channel. Derived from the
 * channel id alone so every device, in any join order, derives the same bytes.
 */
export function channelGroupId(channelId: string): Uint8Array {
  return utf8Encode(`aulora:channel:${channelId}`);
}

/** A channel name/topic/emoji is encrypted as a tiny JSON payload. */
export interface TextPayload {
  readonly text: string;
}

export function encodeText(text: string): Uint8Array {
  return encodePayload({ text } satisfies TextPayload);
}
