import { ConvexError } from "convex/values";

/**
 * Short-lived, signed download tokens for server-sealed file bytes.
 *
 * A token is `base64url(payload) + "." + base64url(HMAC-SHA256(payload))` where
 * the payload is `{ fileId, userId, exp }`. It lets a client fetch decrypted
 * bytes without a live Convex session, so the signature key comes from
 * `AULORA_ENCRYPTION_KEY` (base64, 32 bytes) or, falling back, `INSTANCE_SECRET`.
 * Tokens carry no key material and are not logged.
 */

type Env = Record<string, string | undefined>;

type Bytes = Uint8Array<ArrayBuffer>;

export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface DownloadTokenPayload {
  readonly fileId: string;
  readonly userId: string;
  readonly exp: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64UrlEncode(bytes: Bytes): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Bytes {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function keyMaterial(env: Env): Bytes {
  const direct = read(env, "AULORA_ENCRYPTION_KEY");
  if (direct !== undefined) {
    const decoded = base64UrlDecode(direct);
    if (decoded.length !== 32) {
      throw new ConvexError("AULORA_ENCRYPTION_KEY must decode to 32 bytes");
    }
    return decoded;
  }
  const secret = read(env, "INSTANCE_SECRET");
  if (!secret) {
    throw new ConvexError("No file download signing key configured");
  }
  return textEncoder.encode(secret);
}

async function importKey(env: Env): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    keyMaterial(env),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs a download token; never includes key material. */
export async function signDownloadToken(
  payload: DownloadTokenPayload,
  opts: { env?: Env } = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const body = base64UrlEncode(
    textEncoder.encode(JSON.stringify({ f: payload.fileId, u: payload.userId, e: payload.exp })),
  );
  const key = await importKey(env);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, textEncoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function splitToken(token: string): { body: string; signature: Bytes } {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new ConvexError("Malformed download token");
  }
  const body = parts[0] ?? "";
  const signaturePart = parts[1] ?? "";
  if (body.length === 0 || signaturePart.length === 0) {
    throw new ConvexError("Malformed download token");
  }
  try {
    return { body, signature: base64UrlDecode(signaturePart) };
  } catch {
    throw new ConvexError("Malformed download token");
  }
}

function decodePayload(body: string): DownloadTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(base64UrlDecode(body)));
  } catch {
    throw new ConvexError("Malformed download token");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ConvexError("Malformed download token");
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.f !== "string" ||
    record.f.length === 0 ||
    typeof record.u !== "string" ||
    typeof record.e !== "number" ||
    !Number.isFinite(record.e)
  ) {
    throw new ConvexError("Malformed download token");
  }
  return { fileId: record.f, userId: record.u, exp: record.e };
}

/** Verifies token signature and expiry, returning the payload. */
export async function verifyDownloadToken(
  token: string,
  opts: { env?: Env; now?: number } = {},
): Promise<DownloadTokenPayload> {
  const { body, signature } = splitToken(token);
  const env = opts.env ?? process.env;
  const key = await importKey(env);
  const valid = await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    textEncoder.encode(body),
  );
  if (!valid) {
    throw new ConvexError("Invalid download token");
  }
  const payload = decodePayload(body);
  const now = opts.now ?? Date.now();
  if (payload.exp <= now) {
    throw new ConvexError("Download token expired");
  }
  return payload;
}
