/**
 * Ephemeral TURN credentials (RFC 5766 `TURN REST API` / coturn
 * `static-auth-secret`).
 *
 * The deployment's TURN server shares one static secret with the backend and
 * never stores per-user passwords. The backend mints, for one member, a
 * username of `<expiry>:<user id>` and the base64 HMAC-SHA1 of that username
 * under the secret. The relay recomputes the HMAC and accepts the credential
 * until `expiry`, so a leaked credential stops working on its own and no
 * operator ever hand-writes an ICE configuration with a long-lived password.
 *
 * The HMAC uses Web Crypto, which the Convex default runtime and Node's test
 * environment both provide; no Node-only module is imported here.
 */
import type { TurnSettings } from "./env";

export interface TurnCredentials {
  /** `turn:`/`turns:` URLs the client adds to its ICE servers. */
  readonly urls: readonly string[];
  readonly username: string;
  readonly credential: string;
  readonly ttlSeconds: number;
  /** Epoch seconds at which the relay stops accepting the credential. */
  readonly expiresAt: number;
}

const encoder = new TextEncoder();
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with `=` padding, over raw bytes. */
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triplet = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    out += BASE64_ALPHABET[(triplet >> 18) & 63];
    out += BASE64_ALPHABET[(triplet >> 12) & 63];
    out += second === undefined ? "=" : BASE64_ALPHABET[(triplet >> 6) & 63];
    out += third === undefined ? "=" : BASE64_ALPHABET[triplet & 63];
  }
  return out;
}

/** The coturn username for one member: `<expiry>:<user id>`. */
export function turnUsername(expiresAt: number, userId: string): string {
  return `${expiresAt}:${userId}`;
}

/** base64(HMAC-SHA1(secret, username)), the password half of the pair. */
export async function turnCredential(secret: string, username: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  return base64(new Uint8Array(signature));
}

/**
 * Mints one member's short-lived relay credential. `now` is injectable so tests
 * and callers can pin the expiry.
 */
export async function buildTurnCredentials(input: {
  readonly settings: TurnSettings;
  readonly userId: string;
  readonly now?: number;
}): Promise<TurnCredentials> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = now + input.settings.ttlSeconds;
  const username = turnUsername(expiresAt, input.userId);
  return {
    urls: [...input.settings.urls],
    username,
    credential: await turnCredential(input.settings.secret, username),
    ttlSeconds: input.settings.ttlSeconds,
    expiresAt,
  };
}
