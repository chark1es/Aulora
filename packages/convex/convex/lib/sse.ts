/**
 * Server-side envelope encryption (SSE).
 *
 * Structured content is sealed by the server with AES-256-GCM. Each sealed
 * value names the master-key version in its header, so reads stay possible
 * across a rotation while writes always use the current version; old content is
 * re-sealed lazily (a later pass can sweep rows whose header version differs).
 *
 * The per-record data key is derived with HKDF-SHA256 from the master key, the
 * workspace salt, the scope and the key version, and the scope/record id/key
 * version are bound into the GCM additional data. Because the key version feeds
 * both the derivation and the AAD, a rotation changes the actual encryption key
 * as well as the authentication context. A ciphertext cannot be moved to a
 * different scope, record or key version without failing authentication.
 *
 * Key handling: the master key is held only in module scope. Local providers
 * derive it in-process; remote providers must be primed from an action/setup/
 * cron (`primeMasterKey`) because queries and mutations may not touch the
 * network. No function here logs or returns key material.
 */

import {
  createEkmClient,
  deriveLocalMasterKey,
  EkmKeyUnavailableError,
  type EkmMasterKey,
  type EkmSettings,
  ekmConfigured,
  getEkmSettings,
} from "./ekm";

export interface EncryptionContext {
  readonly scope: string;
  readonly recordId?: string;
  readonly workspaceId?: string;
}

export type SseErrorCode =
  | "not-sealed"
  | "malformed"
  | "unknown-version"
  | "decrypt-failed"
  | "key-unavailable";

/** Typed failure so callers can distinguish legacy values from tampering. */
export class SseError extends Error {
  readonly code: SseErrorCode;

  constructor(code: SseErrorCode, message: string) {
    super(message);
    this.name = "SseError";
    this.code = code;
  }
}

const ENVELOPE_PREFIX = "aulora-sse-v1";
const SEALED_PREFIX = "aulora-sse-";
/** Advertised in the header; WebCrypto's algorithm name is plain "AES-GCM". */
const ALGORITHM = "AES-256-GCM";
const SUBTLE_ALGORITHM = "AES-GCM";
const IV_BYTES = 12;
const TAG_BITS = 128;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Master key cache keyed by `provider|kekId|keyVersion`. */
const masterKeyCache = new Map<string, EkmMasterKey>();

type Env = Record<string, string | undefined>;

/** A byte view on a plain `ArrayBuffer`, as WebCrypto's overloads require. */
type Bytes = Uint8Array<ArrayBuffer>;

function cacheKey(settings: EkmSettings, keyVersion: string): string {
  return `${settings.provider}|${settings.kekId}|${keyVersion}`;
}

function bytesToBase64Url(bytes: Bytes): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Bytes {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** True when the value looks like an `aulora-sse-*` envelope. */
export function isSealed(value: string): boolean {
  return value.startsWith(SEALED_PREFIX);
}

/** True when the deployment can obtain a master key with the given env. */
export function encryptionConfigured(env: Env = process.env): boolean {
  if (env.AULORA_ENCRYPTION_ENABLED?.trim() === "false") {
    return false;
  }
  const settings = getEkmSettings(env);
  if (settings.provider === "local") {
    return settings.directKek !== undefined || (env.INSTANCE_SECRET?.trim().length ?? 0) > 0;
  }
  return ekmConfigured(settings);
}

/** Clears the in-memory master-key cache. Test seam. */
export function clearKeyCache(): void {
  masterKeyCache.clear();
}

function deriveAad(context: EncryptionContext, keyVersion: string): Bytes {
  return textEncoder.encode(
    `${ENVELOPE_PREFIX}|${context.scope}|${keyVersion}|${context.recordId ?? ""}`,
  );
}

async function deriveDataKey(
  master: Bytes,
  context: EncryptionContext,
  keyVersion: string,
): Promise<CryptoKey> {
  const imported = await globalThis.crypto.subtle.importKey("raw", master, "HKDF", false, [
    "deriveKey",
  ]);
  return await globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: textEncoder.encode(context.workspaceId ?? "default"),
      info: textEncoder.encode(`aulora/sse/v1/${keyVersion}/${context.scope}`),
    },
    imported,
    { name: SUBTLE_ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function resolveMasterKey(env: Env, requestedVersion?: string): Promise<EkmMasterKey> {
  const settings = getEkmSettings(env);
  const keyVersion = requestedVersion ?? settings.keyVersion;
  const cached = masterKeyCache.get(cacheKey(settings, keyVersion));
  if (cached !== undefined) {
    return cached;
  }
  // Local derivation is deterministic for any version and needs no network, so
  // it is safe inside a query/mutation. Remote providers must have been primed.
  if (settings.provider === "local") {
    const bytes = await deriveLocalMasterKey(env, settings);
    const key: EkmMasterKey = {
      bytes,
      kekId: settings.kekId,
      keyVersion,
      provider: "local",
    };
    masterKeyCache.set(cacheKey(settings, keyVersion), key);
    return key;
  }
  throw new EkmKeyUnavailableError(
    `Master key for the ${settings.provider} provider (version ${keyVersion}) is not primed; call primeMasterKey from an action, setup or cron`,
  );
}

/**
 * Fetches (remote) or derives (local) the current master key and caches it for
 * query/mutation use. Safe to call repeatedly; remote providers perform the
 * unwrap round trip here, never during a query or mutation.
 */
export async function primeMasterKey(
  opts: { env?: Env; fetch?: typeof fetch } = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  const settings = getEkmSettings(env);
  if (settings.provider === "local") {
    const bytes = await deriveLocalMasterKey(env, settings);
    masterKeyCache.set(cacheKey(settings, settings.keyVersion), {
      bytes,
      kekId: settings.kekId,
      keyVersion: settings.keyVersion,
      provider: "local",
    });
    return;
  }
  const client = createEkmClient(settings, opts.fetch !== undefined ? { fetch: opts.fetch } : {});
  if (client.unwrap === undefined) {
    throw new EkmKeyUnavailableError(
      `The ${settings.provider} provider has no unwrap implementation`,
    );
  }
  const bytes = await client.unwrap();
  masterKeyCache.set(cacheKey(settings, settings.keyVersion), {
    bytes,
    kekId: settings.kekId,
    keyVersion: settings.keyVersion,
    provider: settings.provider,
  });
}

export async function sealString(
  context: EncryptionContext,
  plaintext: string,
  opts: { env?: Env } = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const master = await resolveMasterKey(env);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const dataKey = await deriveDataKey(master.bytes, context, master.keyVersion);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: SUBTLE_ALGORITHM,
      iv,
      additionalData: deriveAad(context, master.keyVersion),
      tagLength: TAG_BITS,
    },
    dataKey,
    textEncoder.encode(plaintext),
  );
  return `${ENVELOPE_PREFIX}.${master.keyVersion}.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}`;
}

interface SealedStringParts {
  readonly keyVersion: string;
  readonly iv: Bytes;
  readonly ciphertext: Bytes;
}

/** Parses and validates the four dot-separated parts of a sealed string. */
function parseSealedString(sealed: string): SealedStringParts {
  if (!isSealed(sealed)) {
    throw new SseError("not-sealed", "Value is not a server-side envelope");
  }
  const parts = sealed.split(".");
  if (parts[0] !== ENVELOPE_PREFIX) {
    const prefix = parts[0] ?? "";
    if (prefix.startsWith(SEALED_PREFIX)) {
      throw new SseError("unknown-version", `Unsupported envelope version: ${prefix}`);
    }
    throw new SseError("malformed", "Malformed server-side envelope");
  }
  if (parts.length !== 4) {
    throw new SseError("malformed", "Malformed server-side envelope");
  }
  const keyVersion = parts[1] ?? "";
  const ivPart = parts[2] ?? "";
  const cipherPart = parts[3] ?? "";
  if (keyVersion.length === 0 || ivPart.length === 0 || cipherPart.length === 0) {
    throw new SseError("malformed", "Malformed server-side envelope");
  }
  let iv: Bytes;
  let ciphertext: Bytes;
  try {
    iv = base64UrlToBytes(ivPart);
    ciphertext = base64UrlToBytes(cipherPart);
  } catch {
    throw new SseError("malformed", "Envelope carried invalid base64url");
  }
  if (iv.length !== IV_BYTES) {
    throw new SseError("malformed", "Envelope carried an invalid IV length");
  }
  return { keyVersion, iv, ciphertext };
}

export async function openString(
  context: EncryptionContext,
  sealed: string,
  opts: { env?: Env } = {},
): Promise<string> {
  const { keyVersion, iv, ciphertext } = parseSealedString(sealed);
  const env = opts.env ?? process.env;
  const master = await resolveMasterKey(env, keyVersion);
  const dataKey = await deriveDataKey(master.bytes, context, keyVersion);
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: SUBTLE_ALGORITHM,
        iv,
        additionalData: deriveAad(context, keyVersion),
        tagLength: TAG_BITS,
      },
      dataKey,
      ciphertext,
    );
    return textDecoder.decode(plaintext);
  } catch {
    throw new SseError("decrypt-failed", "Envelope failed authentication or context mismatch");
  }
}

interface BytesHeader {
  readonly keyVersion: string;
  readonly iv: Bytes;
}

function parseBytesHeader(parsed: unknown): BytesHeader {
  if (typeof parsed !== "object" || parsed === null) {
    throw new SseError("malformed", "Sealed bytes carried a malformed header");
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) {
    throw new SseError("unknown-version", "Sealed bytes used an unsupported header version");
  }
  if (record.a !== ALGORITHM) {
    throw new SseError("malformed", "Sealed bytes used an unsupported algorithm");
  }
  if (typeof record.kv !== "string" || record.kv.length === 0) {
    throw new SseError("malformed", "Sealed bytes header is missing a key version");
  }
  if (typeof record.i !== "string" || record.i.length === 0) {
    throw new SseError("malformed", "Sealed bytes header is missing an IV");
  }
  let iv: Bytes;
  try {
    iv = base64UrlToBytes(record.i);
  } catch {
    throw new SseError("malformed", "Sealed bytes header carried an invalid IV");
  }
  if (iv.length !== IV_BYTES) {
    throw new SseError("malformed", "Sealed bytes header carried an invalid IV length");
  }
  return { keyVersion: record.kv, iv };
}

export async function sealBytes(
  context: EncryptionContext,
  bytes: Bytes,
  opts: { env?: Env } = {},
): Promise<Bytes> {
  const env = opts.env ?? process.env;
  const master = await resolveMasterKey(env);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const dataKey = await deriveDataKey(master.bytes, context, master.keyVersion);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: SUBTLE_ALGORITHM,
        iv,
        additionalData: deriveAad(context, master.keyVersion),
        tagLength: TAG_BITS,
      },
      dataKey,
      bytes,
    ),
  );
  const header = textEncoder.encode(
    JSON.stringify({ v: 1, kv: master.keyVersion, a: ALGORITHM, i: bytesToBase64Url(iv) }),
  );
  const out = new Uint8Array(4 + header.length + ciphertext.length);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(0, header.length, false);
  out.set(header, 4);
  out.set(ciphertext, 4 + header.length);
  return out;
}

export async function openBytes(
  context: EncryptionContext,
  sealed: Bytes,
  opts: { env?: Env } = {},
): Promise<Bytes> {
  if (sealed.length < 5) {
    throw new SseError("malformed", "Sealed byte envelope is too short");
  }
  const view = new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const headerLength = view.getUint32(0, false);
  if (headerLength === 0 || 4 + headerLength >= sealed.length) {
    throw new SseError("malformed", "Sealed byte envelope carried an invalid header length");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(sealed.subarray(4, 4 + headerLength)));
  } catch {
    throw new SseError("malformed", "Sealed byte envelope carried a non-JSON header");
  }
  const header = parseBytesHeader(parsed);
  const ciphertext = sealed.subarray(4 + headerLength);
  const env = opts.env ?? process.env;
  const master = await resolveMasterKey(env, header.keyVersion);
  const dataKey = await deriveDataKey(master.bytes, context, header.keyVersion);
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: SUBTLE_ALGORITHM,
        iv: header.iv,
        additionalData: deriveAad(context, header.keyVersion),
        tagLength: TAG_BITS,
      },
      dataKey,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new SseError("decrypt-failed", "Sealed bytes failed authentication or context mismatch");
  }
}
