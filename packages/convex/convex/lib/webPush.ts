/**
 * Web Push (RFC 8030) sender built on the VAPID scheme (RFC 8292).
 *
 * The Convex default runtime exposes `crypto.subtle` signing for ECDSA P-256
 * (actions only), which is all a VAPID Authorization header needs. It does
 * **not** expose ECDH `deriveBits`, so RFC 8291 payload encryption is not
 * possible here: these pushes carry an empty body and wake the service worker,
 * which shows a device-computed, content-free notification. That matches the
 * privacy design — the server never learns notification text.
 *
 * No secret is ever logged or returned; `VapidConfig` carries the private key
 * only as far as the fetch headers.
 */

export interface WebPushSubscription {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
}

export interface VapidConfig {
  /** Uncompressed P-256 public point, base64url (65 bytes). */
  readonly publicKey: string;
  /** Raw P-256 private scalar, base64url (32 bytes). */
  readonly privateKey: string;
  /** VAPID `sub` claim, e.g. `mailto:owner@example.com`. */
  readonly subject: string;
}

export interface WebPushSendResult {
  readonly ok: boolean;
  readonly status: number;
  /** The subscription is no longer valid and should be pruned. */
  readonly gone: boolean;
}

/** Max VAPID token lifetime (RFC 8292 recommends no more than 24h). */
const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;

/** Four weeks; push services queue a wake-up for at least this long. */
const DEFAULT_TTL_SECONDS = 2_419_200;

const textEncoder = new TextEncoder();

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parses the JSON a browser `PushSubscription.toJSON()` produced. */
export function parseSubscription(raw: string): WebPushSubscription | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    typeof record.endpoint !== "string" ||
    record.endpoint.length === 0 ||
    typeof record.keys !== "object" ||
    record.keys === null ||
    typeof record.keys.p256dh !== "string" ||
    typeof record.keys.auth !== "string"
  ) {
    return null;
  }
  return {
    endpoint: record.endpoint,
    keys: { p256dh: record.keys.p256dh, auth: record.keys.auth },
  };
}

/** Reads the VAPID key material from the deployment environment, or `null`. */
export function vapidConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey === undefined || privateKey === undefined) {
    return null;
  }
  if (publicKey.length === 0 || privateKey.length === 0) {
    return null;
  }
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || "mailto:owner@example.com",
  };
}

function publicKeyToJwk(publicBytes: Uint8Array, privateKey: string): JsonWebKey {
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error("VAPID public key must be an uncompressed P-256 point");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)),
    d: privateKey,
    ext: true,
  };
}

interface VapidJwtInput {
  readonly config: VapidConfig;
  readonly audience: string;
  /** Unix seconds used for the `exp` claim; injected for deterministic tests. */
  readonly nowSeconds: number;
}

/** Builds a signed ES256 JWT for the VAPID `Authorization` header. */
export async function buildVapidJwt(input: VapidJwtInput): Promise<string> {
  const publicBytes = base64UrlToBytes(input.config.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    publicKeyToJwk(publicBytes, input.config.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = bytesToBase64Url(textEncoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToBase64Url(
    textEncoder.encode(
      JSON.stringify({
        aud: input.audience,
        exp: input.nowSeconds + VAPID_TOKEN_TTL_SECONDS,
        sub: input.config.subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export interface SendWebPushDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly ttlSeconds?: number;
}

/**
 * Sends one empty-body Web Push. Empty payloads need no RFC 8291 encryption,
 * so this stays inside the runtime's Web Crypto surface.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  config: VapidConfig,
  deps: SendWebPushDeps = {},
): Promise<WebPushSendResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await buildVapidJwt({
    config,
    audience,
    nowSeconds: Math.floor(now() / 1000),
  });
  const response = await fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: String(deps.ttlSeconds ?? DEFAULT_TTL_SECONDS),
      Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
  };
}
