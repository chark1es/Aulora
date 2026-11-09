/**
 * Short-lived audio tokens for the optional transcriber service.
 *
 * Convex mints a token when a participant opens a transcription stream; the
 * transcriber verifies it with a key derived from the shared
 * `TRANSCRIBER_TOKEN`. The token binds the transcription session, the exact
 * speaker key and an expiry, so a client can neither claim someone else's
 * identity nor reuse an old token.
 *
 * Wire format: `<base64url(json payload)>.<base64url(HMAC-SHA256)>`.
 *
 * The HMAC covers the base64url *text* of the payload (the exact bytes before
 * the dot), not the decoded JSON. The Python transcriber signs and verifies the
 * same text; `infra/transcriber/test/fixtures/audio-token-vector.json` is the
 * shared fixed vector both sides test against.
 */

import { TRANSCRIPTION_AUDIO_TOKEN_TTL_SECONDS } from "@aulora/core";

export interface AudioTokenClaims {
  /** Transcription session id. */
  readonly sid: string;
  /** Call id, for the transcriber's logging/tests. */
  readonly cid: string;
  /** `user:<id>` or `guest:<id>`. */
  readonly sub: string;
  /**
   * Epoch milliseconds at which the transcription session started. The
   * transcriber turns socket audio into session-relative `startMs`/`endMs`.
   */
  readonly start: number;
  /** Expiry, epoch seconds. */
  readonly exp: number;
  /** Issued-at, epoch seconds. */
  readonly iat: number;
}

const KEY_CONTEXT = "aulora-audio-token-v1";

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Derives the HMAC key from the deployment secret. The secret itself is never
 * used as a key directly, so a leaked token cannot help recover it.
 */
export async function audioTokenKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder().encode(`${secret}\u0000${KEY_CONTEXT}`),
  );
  return await crypto.subtle.importKey(
    "raw",
    new Uint8Array(digest),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Mints an audio token. Throws when the transcriber is not configured. */
export async function mintAudioToken(
  secret: string | undefined,
  claims: Omit<AudioTokenClaims, "iat" | "exp"> & {
    readonly ttlSeconds?: number;
    readonly now?: number;
  },
): Promise<{ token: string; expiresAt: number }> {
  if (secret === undefined || secret.length === 0) {
    throw new Error("The transcriber is not configured");
  }
  const nowSeconds = Math.floor((claims.now ?? Date.now()) / 1000);
  const ttl = claims.ttlSeconds ?? TRANSCRIPTION_AUDIO_TOKEN_TTL_SECONDS;
  const payload: AudioTokenClaims = {
    sid: claims.sid,
    cid: claims.cid,
    sub: claims.sub,
    start: Math.trunc(claims.start),
    iat: nowSeconds,
    exp: nowSeconds + ttl,
  };
  const encoded = base64Url(textEncoder().encode(JSON.stringify(payload)));
  const key = await audioTokenKey(secret);
  // The signed message is the base64url payload text itself, matching the
  // Python transcriber. Signing the decoded JSON instead silently rejects
  // every token the two sides exchange.
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder().encode(encoded)),
  );
  return {
    token: `${encoded}.${base64Url(signature)}`,
    expiresAt: payload.exp * 1000,
  };
}

/** Verifies a token and returns its claims, or `null` for anything invalid. */
export async function verifyAudioToken(
  secret: string,
  token: string,
  now: number = Date.now(),
): Promise<AudioTokenClaims | null> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return null;
  }
  let payloadBytes: Uint8Array<ArrayBuffer>;
  let signature: Uint8Array<ArrayBuffer>;
  let parsed: unknown;
  try {
    payloadBytes = fromBase64Url(token.slice(0, separator));
    signature = fromBase64Url(token.slice(separator + 1));
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const key = await audioTokenKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    textEncoder().encode(token.slice(0, separator)),
  );
  if (!valid) {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.sid !== "string" ||
    typeof record.cid !== "string" ||
    typeof record.sub !== "string" ||
    typeof record.start !== "number" ||
    typeof record.iat !== "number" ||
    typeof record.exp !== "number"
  ) {
    return null;
  }
  if (record.exp * 1000 <= now) {
    return null;
  }
  return {
    sid: record.sid,
    cid: record.cid,
    sub: record.sub,
    start: record.start,
    iat: record.iat,
    exp: record.exp,
  };
}
