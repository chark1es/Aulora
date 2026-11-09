/**
 * Helpers for the native/desktop OAuth handoff.
 *
 * Better Auth binds an OAuth callback to the browser context that started it
 * with a signed `state` cookie. That cookie only survives when both requests
 * happen in the same first-party browsing context, so mobile and desktop
 * clients cannot start OAuth from their app's own fetch stack and then finish
 * in a system browser (or vice versa). The routes in `nativeAuth.ts` start the
 * flow from a page served by the workspace's own origin, then hand the finished
 * session back to the client through a short-lived, single-use opaque code.
 *
 * Keep this file free of Convex imports so the parsing and challenge rules can
 * be unit tested on any host.
 */

import { NATIVE_AUTH_EXPIRED_ERROR, NATIVE_AUTH_TX_TTL_MS } from "@aulora/core";

export type AuthReturnKind = "custom" | "app" | "web";

export interface AuthReturnTarget {
  readonly kind: AuthReturnKind;
  readonly url: string;
}

/** Query parameters used by the custom-scheme (mobile) return. */
export const HANDOFF_CODE_PARAM = "code";
export const HANDOFF_SERVER_PARAM = "server";
export const HANDOFF_ERROR_PARAM = "error";
/**
 * Client-generated transaction id echoed on every redirect. The client keeps it
 * with the verifier and only accepts a callback that names the transaction it
 * started.
 */
export const HANDOFF_TX_PARAM = "tx";

/** Fragment keys used by the app (desktop) and web returns. */
export const HANDOFF_HASH_CODE = "aulora-auth-code";
export const HANDOFF_HASH_SERVER = "aulora-auth-server";
export const HANDOFF_HASH_ERROR = "aulora-auth-error";

/**
 * PKCE-style challenge carried from `native/start` to `native/finish`.
 *
 * The client keeps the verifier locally and sends only its SHA-256 digest
 * (lowercase hex) in the start URL. The finish step stores that digest with the
 * Code, and `native/exchange` accepts the code only when the caller can present
 * a verifier that hashes to it. Without that binding any `aulora://auth`
 * callback would sign a victim into the attacker's account.
 */
export const HANDOFF_CHALLENGE_PARAM = "challenge";

/** SHA-256 hex digest of a PKCE-style verifier. */
const CHALLENGE_PATTERN = /^[0-9a-f]{64}$/;

export function isHandoffChallenge(value: string | null): value is string {
  return value !== null && CHALLENGE_PATTERN.test(value);
}

/**
 * A client-generated transaction id. It only needs to be unpredictable to the
 * attacker (at least 128 bits) and URL-safe, so base64url and hex both fit.
 */
const TX_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function isHandoffTx(value: string | null): value is string {
  return value !== null && TX_PATTERN.test(value);
}

/**
 * Cookie-name prefix that binds `native/finish` to the browser context that
 * started it. The transaction id is appended as a short digest, so two
 * sign-ins started in one browser keep separate cookies instead of
 * overwriting each other.
 */
export const NATIVE_AUTH_TX_COOKIE_PREFIX = "aulora_native_auth_tx_";

export { NATIVE_AUTH_EXPIRED_ERROR, NATIVE_AUTH_TX_TTL_MS };

/**
 * Cookie name for one started transaction. Every start gets its own name, so a
 * later start cannot overwrite the cookie an earlier flow still needs. The
 * cookie expires with the transaction ({@link NATIVE_AUTH_TX_TTL_MS}), which
 * keeps the number of live names bounded.
 */
export async function nativeAuthTxCookieName(tx: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`native-auth-cookie:${tx}`),
  );
  return `${NATIVE_AUTH_TX_COOKIE_PREFIX}${bytesToHex(new Uint8Array(digest)).slice(0, 16)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fixed windows for the native auth HTTP routes. They run before/around Better
 * Auth's own limiter and can trigger provider traffic or mint handoff rows, so
 * they get their own generous budgets. Kept here so route tests can assert the
 * same values the routes use.
 */
export const NATIVE_AUTH_RATE_WINDOW_MS = 60_000;
export const NATIVE_AUTH_START_PER_IP = 30;
export const NATIVE_AUTH_FINISH_PER_IP = 60;
export const NATIVE_AUTH_FINISH_PER_SESSION = 30;
/** One transaction cookie may only drive a handful of finishes per window. */
export const NATIVE_AUTH_FINISH_PER_TX = 5;
export const NATIVE_AUTH_EXCHANGE_PER_IP = 60;

/**
 * Extra lifetime on the transaction cookie beyond the server row. The client
 * writes its pending record before the start request, so its local TTL can lapse
 * while the server row is still valid. Keeping the cookie a little longer lets
 * that late finish reach the server, which then answers the explicit
 * `auth_expired` code instead of silently minting nothing.
 */
export const NATIVE_AUTH_TX_COOKIE_GRACE_MS = 30_000;

/**
 * Per-action ceilings shared by every anonymous caller. The per-address limits
 * stop one client; these stop a distributed flood from turning the routes into
 * unbounded provider or database work. Start is deliberately 20x its per-address
 * limit so a large NAT signing in at once does not trip it. Requests that prove
 * a transaction or code skip the shared bucket entirely (see the route layer).
 */
export const NATIVE_AUTH_START_GLOBAL = NATIVE_AUTH_START_PER_IP * 20;
export const NATIVE_AUTH_FINISH_GLOBAL = 600;
export const NATIVE_AUTH_EXCHANGE_GLOBAL = 600;

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Encodes the transaction id and its HMAC into one cookie value. The cookie is
 * HttpOnly and path-scoped, so a script on the workspace origin cannot set it;
 * the signature additionally rejects a value planted by another path.
 */
export async function signHandoffTransaction(secret: string, tx: string): Promise<string> {
  return `${tx}.${await hmacSha256Hex(secret, tx)}`;
}

/**
 * Verifies a transaction cookie and returns its id, or `null` for a malformed,
 * tampered or unsigned value. Comparison is constant-time.
 */
export async function readHandoffTransaction(
  secret: string,
  raw: string | null,
): Promise<string | null> {
  if (raw === null || secret.length === 0) {
    return null;
  }
  const separator = raw.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const tx = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!isHandoffTx(tx) || !/^[0-9a-f]{64}$/.test(signature)) {
    return null;
  }
  const expected = await hmacSha256Hex(secret, tx);
  // A byte-wise loop keeps the comparison independent of the first mismatch.
  const encoder = new TextEncoder();
  const left = encoder.encode(signature);
  const right = encoder.encode(expected);
  if (left.length !== right.length) {
    return null;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0 ? tx : null;
}

/**
 * Error codes a client is allowed to show. Provider and Better Auth failures
 * arrive as query parameters on the finish route, so the server filters them
 * before putting one in a deep link or fragment: an unknown value could carry
 * attacker-written text into the app. Clients still map an unknown code (for
 * example from an older server) to a generic message.
 */
const HANDOFF_ERROR_CODES: ReadonlySet<string> = new Set([
  NATIVE_AUTH_EXPIRED_ERROR,
  "access_denied",
  "account_not_linked",
  "auth_cancelled",
  "auth_failed",
  "email_not_found",
  "invalid_code",
  "invalid_provider",
  "invalid_request",
  "please_restart_the_process",
  "provider_unavailable",
  "rate_limited",
  "server_error",
  "signup_disabled",
  "state_mismatch",
  "temporarily_unavailable",
  "unable_to_create_user",
]);

/**
 * Normalizes a provider/Better Auth error for the handoff. `access_denied` is
 * the OAuth spelling of a cancelled sign-in; everything not on the allowlist
 * becomes the generic `auth_failed`.
 */
export function sanitizeHandoffError(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized === "access_denied") {
    return "auth_cancelled";
  }
  return HANDOFF_ERROR_CODES.has(normalized) ? normalized : "auth_failed";
}

/**
 * Splits Better Auth's `context.baseURL` into the workspace origin and the auth
 * API base. `baseURL` already carries Better Auth's `/api/auth` base path
 * (`getBaseURL` appends it to a bare origin), so routes must append their path
 * to it rather than adding `/api/auth` again. Clients, in turn, address the
 * workspace origin and append `/api/auth/native/exchange` themselves.
 */
export function nativeAuthUrls(contextBaseURL: string): {
  readonly siteOrigin: string;
  readonly authBase: string;
} {
  const authBase = contextBaseURL.replace(/\/+$/, "");
  return { siteOrigin: new URL(authBase).origin, authBase };
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function originOf(url: URL): string | null {
  try {
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/**
 * Parses and validates the `return` target a client asked to be sent back to.
 *
 * Only the app's own schemes and origins the deployment already trusts are
 * accepted, so the start route can never become an open redirect. Expo's
 * development scheme is accepted only while the workspace itself is on a
 * loopback host, where a development client is the only place it appears.
 */
export function parseAuthReturnTarget(
  raw: string | null,
  trustedOrigins: readonly string[],
  siteOrigin: string,
): AuthReturnTarget | null {
  if (raw === null || raw.trim().length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol === "aulora:") {
    return { kind: "custom", url: url.toString() };
  }

  // Expo Go uses `exp://` / `exps://` for a development deep link. It is only
  // accepted for a loopback workspace, never for a deployed instance.
  let siteHost = "";
  try {
    siteHost = new URL(siteOrigin).hostname;
  } catch {
    siteHost = "";
  }
  if ((url.protocol === "exp:" || url.protocol === "exps:") && isLoopback(siteHost)) {
    return { kind: "custom", url: url.toString() };
  }

  if (url.protocol === "tauri:") {
    return url.hostname === "localhost" ? { kind: "app", url: url.toString() } : null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (url.hostname === "tauri.localhost") {
    return { kind: "app", url: url.toString() };
  }

  const origin = originOf(url);
  if (origin === null) {
    return null;
  }

  if (origin === siteOrigin) {
    return { kind: "web", url: origin };
  }

  const trusted = trustedOrigins.some((candidate) => {
    try {
      return originOf(new URL(candidate)) === origin;
    } catch {
      return candidate === origin;
    }
  });
  if (trusted) {
    return { kind: "web", url: origin };
  }

  return null;
}

function hashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}

/**
 * Appends handoff parameters to a return target in the form that target reads:
 * a query string for a custom scheme (the router passes those as deep-link
 * params), and a fragment for the desktop/web app (never sent to a server).
 */
export function withHandoffParams(
  target: AuthReturnTarget,
  params: Readonly<Record<string, string>>,
): string {
  const url = new URL(target.url);
  if (target.kind === "custom") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
  const hash = hashParams(url);
  for (const [key, value] of Object.entries(params)) {
    hash.set(key, value);
  }
  url.hash = hash.toString();
  return url.toString();
}
