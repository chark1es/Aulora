/**
 * OAuth starts and finishes on the workspace's own origin.
 *
 * Better Auth binds an OAuth callback to the browser context that started it
 * with a signed `state` cookie. A client that starts sign-in from a different
 * origin (the desktop shell's `tauri://localhost`, a dev server on another
 * port) or from its own fetch stack (the mobile app) loses that cookie, and the
 * callback fails with `state_mismatch`. Every provider button therefore opens
 * the workspace's `/api/auth/native/start` page in the browser context that
 * will receive the callback.
 *
 * Starting a flow also writes a short-lived pending transaction: a random
 * PKCE-style verifier kept in this browsing context, the SHA-256 challenge sent
 * to the server, and a client-minted `tx` the server echoes on every redirect.
 * Finishing only succeeds when a callback matches that pending workspace,
 * transaction id and verifier, so an attacker cannot sign a victim into the
 * attacker's session with a crafted `aulora://auth` link — or cancel a real
 * sign-in with one that merely names the workspace origin.
 *
 * Desktop and mobile clients finish on a custom scheme; the workspace hands
 * back an opaque single-use code that the app exchanges for its bearer session
 * token. A plain browser finishes on the workspace origin and needs no token.
 */

import { NATIVE_AUTH_EXPIRED_ERROR, NATIVE_AUTH_TX_TTL_MS } from "@aulora/core";
import { isDesktop, openExternal } from "./desktop";
import { authCallbackUrl } from "./public-origin";
import { writeSessionToken } from "./session-token";

export type OAuthDelivery = "in-app" | "external";

export interface OAuthProviderRef {
  readonly id: string;
  readonly type: "oauth" | "oidc";
}

/** The deep link an external browser sends the desktop shell back to. */
export const DESKTOP_AUTH_RETURN = "aulora://auth/callback";

/** The return target for a browser or webview on the app's own origin. */
export function webAuthReturnUrl(): string {
  return authCallbackUrl();
}

/**
 * The first-party page that sets the OAuth state cookie and redirects to the
 * provider. `returnUrl` is where the finish step hands control back, and
 * `challenge` is the SHA-256 digest of the client-held verifier.
 */
export function oauthStartUrl(
  serverUrl: string,
  provider: OAuthProviderRef,
  returnUrl: string,
  challenge: string,
  tx: string,
): string {
  const base = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  const url = new URL(`${base}/api/auth/native/start`);
  url.searchParams.set("provider", provider.id);
  url.searchParams.set("kind", provider.type);
  url.searchParams.set("return", returnUrl);
  url.searchParams.set("challenge", challenge);
  // The workspace echoes this on every redirect back, so a link that merely
  // names the workspace origin cannot end the transaction this tab started.
  url.searchParams.set("tx", tx);
  return url.toString();
}

/** Starts OAuth in the chosen context. External is desktop-only. */
export function beginOAuth(startUrl: string, delivery: OAuthDelivery): void {
  if (delivery === "external" && isDesktop()) {
    openExternal(startUrl);
    return;
  }
  window.location.assign(startUrl);
}

const HASH_CODE = "aulora-auth-code";
const HASH_SERVER = "aulora-auth-server";
const HASH_ERROR = "aulora-auth-error";
/** The workspace echoes the plain `tx` name into every return target. */
const HANDOFF_TX = "tx";
/** Older draft clients used the prefixed fragment name; accept it too. */
const HASH_TX = "aulora-auth-tx";
const STORED_ERROR_KEY = "aulora.auth.handoffError";
const PENDING_KEY = "aulora.auth.pendingHandoff";

/**
 * How long a stored finish-step error may be shown. It is scoped to the
 * workspace origin that produced it, so a late callback for one profile can
 * never paint an error into another workspace's sign-in screen.
 */
export const STORED_HANDOFF_ERROR_TTL_MS = 5 * 60 * 1000;

interface StoredHandoffError {
  readonly message: string;
  readonly server: string;
  readonly at: number;
}

/**
 * How long a started sign-in may take before its local binding lapses. Shared
 * with the server's transaction lifetime so a callback is never refused as
 * expired while the client is still willing to finish it.
 */
export const PENDING_HANDOFF_TTL_MS = NATIVE_AUTH_TX_TTL_MS;

/**
 * The client-generated transaction id that must come back on every finish
 * redirect. It is at least 128 bits, URL-safe, and lives only with this
 * pending transaction.
 */
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function isHandoffTransactionId(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && TRANSACTION_ID_PATTERN.test(value);
}

export interface PendingAuthHandoff {
  readonly verifier: string;
  readonly server: string;
  readonly returnUrl: string;
  readonly tx: string;
  readonly createdAt: number;
}

export interface AuthHandoff {
  readonly code: string;
  readonly server: string;
  readonly tx?: string | undefined;
}

export type AuthHandoffResult =
  | { readonly kind: "handoff"; readonly handoff: AuthHandoff }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly server: string | null;
      readonly tx?: string | undefined;
    }
  | null;

function paramsFromHash(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A 256-bit random verifier; the server only ever sees its digest. */
export function createHandoffVerifier(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * A 256-bit random transaction id. The server receives it in the start URL and
 * echoes it on the finish redirect; unlike the verifier, it is not a secret
 * from the workspace, only from anyone who did not start this sign-in.
 */
export function createHandoffTransactionId(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** The SHA-256 hex digest sent to `/api/auth/native/start`. */
export async function handoffChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Mints a verifier and transaction id, remembers them with the workspace that
 * should finish the flow, and returns the values to put in the start URL.
 */
export async function prepareOAuthStart(
  serverUrl: string,
  returnUrl: string,
  now: number = Date.now(),
): Promise<{ readonly challenge: string; readonly tx: string }> {
  const server = originOf(serverUrl);
  if (server === null) {
    throw new Error("The workspace URL is not a valid origin.");
  }
  const verifier = createHandoffVerifier();
  const tx = createHandoffTransactionId();
  const challenge = await handoffChallenge(verifier);
  writePendingHandoff({ verifier, server, returnUrl, tx, createdAt: now });
  return { challenge, tx };
}

function writePendingHandoff(pending: PendingAuthHandoff): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without storage the callback will be rejected rather than completed
    // without a binding, which is the safe failure.
  }
}

/** Reads the pending transaction, removing it once its short TTL has passed. */
export function readPendingHandoff(now: number = Date.now()): PendingAuthHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      window.sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.verifier !== "string" ||
      record.verifier.length === 0 ||
      typeof record.server !== "string" ||
      record.server.length === 0 ||
      typeof record.returnUrl !== "string" ||
      !isHandoffTransactionId(typeof record.tx === "string" ? record.tx : undefined) ||
      typeof record.createdAt !== "number"
    ) {
      window.sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    if (record.createdAt + PENDING_HANDOFF_TTL_MS <= now) {
      window.sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return {
      verifier: record.verifier,
      server: record.server,
      returnUrl: record.returnUrl,
      tx: record.tx as string,
      createdAt: record.createdAt,
    };
  } catch {
    return null;
  }
}

/** Drops the pending transaction after it has been used (or rejected). */
export function clearPendingHandoff(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage can be blocked; the stale row expires on its own.
  }
}

/** Reads the finish-step parameters from a URL fragment (or query). */
export function readAuthHandoff(
  hash: string = typeof window === "undefined" ? "" : window.location.hash,
  search: string = typeof window === "undefined" ? "" : window.location.search,
): AuthHandoffResult {
  const hashParams = paramsFromHash(hash);
  const searchParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  // The transaction id is minted by this client, so the finish step can only
  // echo it back as `tx` (the same name it uses on the custom-scheme query). A
  // callback without it is never accepted; see
  // `completeAuthHandoffFromLocation`.
  const tx =
    hashParams.get(HANDOFF_TX) ??
    hashParams.get(HASH_TX) ??
    searchParams.get(HANDOFF_TX) ??
    searchParams.get(HASH_TX) ??
    undefined;
  const error = hashParams.get(HASH_ERROR) ?? searchParams.get(HASH_ERROR);
  if (error !== null && error.length > 0) {
    // The finish step names the workspace that issued the error so the client
    // can tell a real callback from a stray link. Older servers sent no server;
    // those are ignored rather than allowed to cancel a pending sign-in.
    const errorServer = hashParams.get(HASH_SERVER) ?? searchParams.get("server");
    return { kind: "error", message: error, server: errorServer, tx };
  }
  const code = hashParams.get(HASH_CODE);
  const server = hashParams.get(HASH_SERVER);
  if (code === null || code.length === 0 || server === null || server.length === 0) {
    return null;
  }
  return { kind: "handoff", handoff: { code, server, tx } };
}

/** Removes the handoff parameters so a reload cannot replay a spent code. */
export function clearAuthHandoff(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete(HASH_CODE);
  url.searchParams.delete(HASH_SERVER);
  url.searchParams.delete(HASH_ERROR);
  url.searchParams.delete(HANDOFF_TX);
  url.searchParams.delete(HASH_TX);
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Stores a finish-step error for the sign-in screen of the named workspace. */
export function storeAuthHandoffError(message: string, server: string): void {
  const origin = originOf(server);
  if (origin === null) {
    return;
  }
  try {
    window.sessionStorage.setItem(
      STORED_ERROR_KEY,
      JSON.stringify({ message, server: origin, at: Date.now() } satisfies StoredHandoffError),
    );
  } catch {
    // Storage unavailable: the generic sign-in error still covers it.
  }
}

/**
 * Reads and consumes the finish-step error only when it belongs to the active
 * workspace. A record for another profile is left to age out instead of being
 * shown, and one older than {@link STORED_HANDOFF_ERROR_TTL_MS} is discarded.
 */
export function takeStoredAuthHandoffError(
  currentServer?: string,
  now: number = Date.now(),
): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORED_ERROR_KEY);
    if (raw === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      window.sessionStorage.removeItem(STORED_ERROR_KEY);
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
      window.sessionStorage.removeItem(STORED_ERROR_KEY);
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.message !== "string" ||
      record.message.length === 0 ||
      typeof record.server !== "string" ||
      originOf(record.server) !== record.server ||
      typeof record.at !== "number"
    ) {
      window.sessionStorage.removeItem(STORED_ERROR_KEY);
      return null;
    }
    if (record.at + STORED_HANDOFF_ERROR_TTL_MS <= now) {
      window.sessionStorage.removeItem(STORED_ERROR_KEY);
      return null;
    }
    const activeServer = currentServer === undefined ? null : originOf(currentServer);
    if (activeServer === null || activeServer !== record.server) {
      return null;
    }
    window.sessionStorage.removeItem(STORED_ERROR_KEY);
    return record.message;
  } catch {
    return null;
  }
}

/** Drops a stored finish-step error after a successful sign-in. */
export function clearStoredAuthHandoffError(): void {
  try {
    window.sessionStorage.removeItem(STORED_ERROR_KEY);
  } catch {
    // Storage can be blocked; a stale record still expires on its own.
  }
}

/** How long the token exchange may take before boot gives up on it. */
export const AUTH_EXCHANGE_TIMEOUT_MS = 10_000;

/** Thrown when the token exchange outlives {@link AUTH_EXCHANGE_TIMEOUT_MS}. */
export class AuthExchangeTimeoutError extends Error {
  constructor() {
    super("The authentication exchange timed out.");
    this.name = "AuthExchangeTimeoutError";
  }
}

export function isAuthExchangeTimeout(error: unknown): error is AuthExchangeTimeoutError {
  return error instanceof AuthExchangeTimeoutError;
}

/**
 * Trades a handoff code and its pending verifier for the workspace's bearer
 * session token.
 *
 * The whole exchange is bounded, not just the headers: a workspace that
 * answers `200` and then stalls the body would otherwise leave boot waiting on
 * `response.json()` forever. The fetch and the body parse are raced together
 * against {@link AUTH_EXCHANGE_TIMEOUT_MS} and aborted at that point.
 */
export async function exchangeAuthHandoff(
  handoff: AuthHandoff,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = AUTH_EXCHANGE_TIMEOUT_MS,
): Promise<boolean> {
  const base = handoff.server.endsWith("/") ? handoff.server.slice(0, -1) : handoff.server;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AuthExchangeTimeoutError());
    }, timeoutMs);
  });
  const exchange = (async (): Promise<boolean> => {
    const response = await fetchImpl(`${base}/api/auth/native/exchange`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: handoff.code, verifier }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || !("token" in data)) {
      return false;
    }
    const token = (data as { token?: unknown }).token;
    if (typeof token !== "string" || token.length === 0) {
      return false;
    }
    writeSessionToken(handoff.server, token);
    return true;
  })();
  try {
    return await Promise.race([exchange, deadline]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AuthExchangeTimeoutError();
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Finishes a handoff only when it matches the pending transaction in this
 * browsing context: same workspace, same client-minted `tx`, before the local
 * TTL, with its verifier.
 */
async function completeHandoff(
  handoff: AuthHandoff,
  now: number = Date.now(),
  timeoutMs: number = AUTH_EXCHANGE_TIMEOUT_MS,
): Promise<boolean> {
  const pending = readPendingHandoff(now);
  if (pending === null) {
    return false;
  }
  if (!isHandoffTransactionId(handoff.tx) || handoff.tx !== pending.tx) {
    // Matching the workspace origin is not authentication: only a redirect
    // that echoes this tab's transaction id may finish its sign-in.
    return false;
  }
  if (originOf(handoff.server) !== pending.server) {
    // A callback for another workspace must not consume or replace the pending
    // sign-in this tab is actually waiting for.
    return false;
  }
  clearPendingHandoff();
  try {
    const completed = await exchangeAuthHandoff(handoff, pending.verifier, undefined, timeoutMs);
    if (completed) {
      // A successful sign-in must not leave an older failure on the next
      // sign-in screen.
      clearStoredAuthHandoffError();
    }
    return completed;
  } catch (error) {
    storeAuthHandoffError(
      isAuthExchangeTimeout(error)
        ? "Sign-in timed out, please try again"
        : "Could not complete sign-in.",
      pending.server,
    );
    return false;
  }
}

/** Removes a finish URL that carried only the echoed transaction id. */
function clearTransactionOnlyLocation(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  const hash = paramsFromHash(url.hash);
  const handoffKeys = new Set([HANDOFF_TX, HASH_TX]);
  const hasTx =
    hash.has(HANDOFF_TX) ||
    hash.has(HASH_TX) ||
    url.searchParams.has(HANDOFF_TX) ||
    url.searchParams.has(HASH_TX);
  const onlyTx =
    hasTx &&
    Array.from(hash.keys()).every((key) => handoffKeys.has(key)) &&
    Array.from(url.searchParams.keys()).every((key) => handoffKeys.has(key));
  if (onlyTx) {
    clearAuthHandoff();
  }
}

/**
 * Displays the one late callback a client may accept without a pending record:
 * an `auth_expired` redirect that carries a well-formed `tx` and names the
 * workspace this app is currently using. It only stores the message for the
 * sign-in screen; it never completes a sign-in, clears another flow, or accepts
 * any other error or code.
 */
function storeExpiredWithoutPending(
  message: string,
  server: string | null,
  tx: string | undefined,
  currentServer: string | undefined,
): boolean {
  if (message !== NATIVE_AUTH_EXPIRED_ERROR) {
    return false;
  }
  if (!isHandoffTransactionId(tx)) {
    return false;
  }
  if (server === null || currentServer === undefined) {
    return false;
  }
  const errorServer = originOf(server);
  if (errorServer === null || errorServer !== originOf(currentServer)) {
    return false;
  }
  storeAuthHandoffError(message, errorServer);
  return true;
}

/**
 * Completes a finish redirect left in the address bar. Returns `true` when the
 * app is now signed in; removes the parameters either way. `currentServer` is
 * this app's active workspace, used only to show a late `auth_expired` message.
 */
export async function completeAuthHandoffFromLocation(
  timeoutMs: number = AUTH_EXCHANGE_TIMEOUT_MS,
  currentServer?: string,
): Promise<boolean> {
  const result = readAuthHandoff();
  if (result === null) {
    // A successful same-origin web finish echoes only `tx`; clear that leftover
    // fragment so it does not stay in the address bar.
    clearTransactionOnlyLocation();
    return false;
  }
  clearAuthHandoff();
  const pending = readPendingHandoff();
  if (result.kind === "error") {
    // A random link cannot paint an error into the sign-in screen or cancel a
    // sign-in unless this tab really did start one against that workspace and
    // the redirect echoes its transaction id. A missing tx (an older server)
    // is not a match either.
    const errorServer = result.server === null ? null : originOf(result.server);
    if (pending !== null) {
      if (
        isHandoffTransactionId(result.tx) &&
        result.tx === pending.tx &&
        errorServer !== null &&
        errorServer === pending.server
      ) {
        storeAuthHandoffError(result.message, pending.server);
        clearPendingHandoff();
      }
      return false;
    }
    // The local pending record lapsing first is the one case where a real
    // callback still deserves the explicit timeout message.
    storeExpiredWithoutPending(result.message, result.server, result.tx, currentServer);
    return false;
  }
  return await completeHandoff(result.handoff, undefined, timeoutMs);
}

/** Completes the deep link an external browser hands the desktop shell. */
export async function completeDesktopAuthDeepLink(
  code: string,
  server: string,
  tx: string | undefined,
  timeoutMs: number = AUTH_EXCHANGE_TIMEOUT_MS,
): Promise<boolean> {
  return await completeHandoff({ code, server, tx }, undefined, timeoutMs);
}

/**
 * Applies an error deep link from an external browser. Like the success path it
 * only acts when the link names the workspace and transaction this tab started;
 * a forged or stale error is ignored without touching the pending sign-in.
 * Returns `true` when a real error was shown.
 */
export async function completeDesktopAuthErrorDeepLink(
  message: string,
  server: string,
  tx: string | undefined,
  now: number = Date.now(),
  currentServer?: string,
): Promise<boolean> {
  const pending = readPendingHandoff(now);
  if (pending === null) {
    // A lapsed local pending record is still worth the explicit timeout
    // message when the link names this app's current workspace.
    return storeExpiredWithoutPending(message, server, tx, currentServer);
  }
  if (!isHandoffTransactionId(tx) || tx !== pending.tx) {
    return false;
  }
  if (originOf(server) !== pending.server) {
    return false;
  }
  storeAuthHandoffError(message, pending.server);
  clearPendingHandoff();
  return true;
}
