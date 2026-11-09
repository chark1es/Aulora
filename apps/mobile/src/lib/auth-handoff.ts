import { NATIVE_AUTH_EXPIRED_ERROR, NATIVE_AUTH_TX_TTL_MS } from "@aulora/core";
import { authTokenKey, type CookieStore } from "./cookie-fetch";

/**
 * OAuth starts on the workspace's own origin, because that is the browser
 * context that receives Better Auth's callback and its signed state cookie.
 * Native clients open the start page in the in-app browser or the system
 * browser, and the workspace hands the finished session back as a single-use
 * code on the `aulora://auth/callback` deep link.
 *
 * A started flow also stores a random PKCE-style verifier and a client-minted
 * `tx` under {@link PENDING_HANDOFF_KEY}. The server only receives the
 * verifier's SHA-256 challenge, so a code can be exchanged only by the install
 * that started that sign-in; it echoes `tx` on every redirect, so a link that
 * merely names the workspace origin cannot cancel or finish the flow either.
 * The pending record expires quickly and is cleared as soon as it is used.
 */

/** Key in the app's cookie store for the in-flight sign-in transaction. */
export const PENDING_HANDOFF_KEY = "aulora.auth.pendingHandoff";

/** Key for an error the callback route wants the sign-in screen to explain. */
export const HANDOFF_ERROR_KEY = "aulora.auth.handoffError";

/** How long a started sign-in may take before its local binding lapses. */
export const PENDING_HANDOFF_TTL_MS = NATIVE_AUTH_TX_TTL_MS;

/**
 * How long a stored callback error may be shown. It is scoped to the workspace
 * origin that produced it, so a late callback for one profile can never paint
 * an error into another workspace's sign-in screen.
 */
export const STORED_HANDOFF_ERROR_TTL_MS = 5 * 60 * 1000;

/**
 * Friendly copy for the OAuth error codes the finish route can return. Shared
 * by the in-app browser flow and the external deep-link callback, which only
 * has the code to work from.
 */
export function providerSignInErrorMessage(code: string): string {
  const normalized = code.toLowerCase().replaceAll("_", " ");
  if (normalized === NATIVE_AUTH_EXPIRED_ERROR.replaceAll("_", " ")) {
    return "Sign-in took too long, please try again.";
  }
  if (normalized.includes("cancel")) {
    return "Sign-in was cancelled. Try again.";
  }
  if (normalized.includes("state mismatch")) {
    return "Sign-in expired before it finished. Try again.";
  }
  if (normalized.includes("provider unavailable") || normalized.includes("invalid provider")) {
    return "That sign-in provider is not available right now. Try again.";
  }
  return "Sign-in could not be completed. Try again.";
}

export function authStartUrl(
  siteUrl: string,
  providerId: string,
  type: "oauth" | "oidc",
  returnUrl: string,
  challenge: string,
  tx: string,
): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  const url = new URL(`${base}/api/auth/native/start`);
  url.searchParams.set("provider", providerId);
  url.searchParams.set("kind", type);
  url.searchParams.set("return", returnUrl);
  url.searchParams.set("challenge", challenge);
  // Echoed back on every redirect; a link that only names the workspace origin
  // cannot end the transaction this install started.
  url.searchParams.set("tx", tx);
  return url.toString();
}

export interface AuthRedirectParams {
  readonly code?: string;
  readonly server?: string;
  readonly error?: string;
  readonly tx?: string;
}

export interface PendingAuthHandoff {
  readonly verifier: string;
  readonly server: string;
  readonly tx: string;
  readonly createdAt: number;
}

/**
 * The client-generated transaction id that must come back on every finish
 * redirect. It is at least 128 bits, URL-safe, and lives only with this
 * pending transaction.
 */
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function isAuthTransactionId(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && TRANSACTION_ID_PATTERN.test(value);
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/** Reads the handoff parameters from a native redirect URL. */
export function readAuthRedirectParams(raw: string): AuthRedirectParams | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const read = (key: string): string | undefined => {
    const value = url.searchParams.get(key);
    return value === null || value.length === 0 ? undefined : value;
  };
  return {
    code: read("code"),
    server: read("server"),
    error: read("error"),
    tx: read("tx"),
  };
}

/** Remembers the verifier and transaction id for the workspace finishing sign-in. */
export async function beginAuthHandoff(
  store: CookieStore,
  siteUrl: string,
  verifier: string,
  tx: string,
  now: number = Date.now(),
): Promise<void> {
  const server = originOf(siteUrl);
  if (server === null || verifier.length === 0 || !isAuthTransactionId(tx)) {
    throw new Error("Cannot start sign-in without a workspace origin, verifier and transaction.");
  }
  await store.setItem(
    PENDING_HANDOFF_KEY,
    JSON.stringify({ verifier, server, tx, createdAt: now } satisfies PendingAuthHandoff),
  );
}

/** Reads the pending transaction, removing it once its short TTL has passed. */
export async function readPendingAuthHandoff(
  store: CookieStore,
  now: number = Date.now(),
): Promise<PendingAuthHandoff | null> {
  const raw = await store.getItem(PENDING_HANDOFF_KEY);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await store.removeItem(PENDING_HANDOFF_KEY);
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    await store.removeItem(PENDING_HANDOFF_KEY);
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.verifier !== "string" ||
    record.verifier.length === 0 ||
    typeof record.server !== "string" ||
    record.server.length === 0 ||
    !isAuthTransactionId(typeof record.tx === "string" ? record.tx : undefined) ||
    typeof record.createdAt !== "number"
  ) {
    await store.removeItem(PENDING_HANDOFF_KEY);
    return null;
  }
  if (record.createdAt + PENDING_HANDOFF_TTL_MS <= now) {
    await store.removeItem(PENDING_HANDOFF_KEY);
    return null;
  }
  return {
    verifier: record.verifier,
    server: record.server,
    tx: record.tx as string,
    createdAt: record.createdAt,
  };
}

/** Drops the pending transaction after it has been used. */
export async function clearPendingAuthHandoff(store: CookieStore): Promise<void> {
  await store.removeItem(PENDING_HANDOFF_KEY);
}

interface StoredAuthHandoffError {
  readonly message: string;
  readonly server: string;
  readonly at: number;
}

/** Remembers a callback failure for the named workspace's sign-in screen. */
export async function storeAuthHandoffError(
  store: CookieStore,
  message: string,
  server: string,
): Promise<void> {
  const origin = originOf(server);
  if (origin === null) {
    return;
  }
  await store.setItem(
    HANDOFF_ERROR_KEY,
    JSON.stringify({ message, server: origin, at: Date.now() } satisfies StoredAuthHandoffError),
  );
}

/**
 * Reads and consumes the last callback failure only when it belongs to the
 * active workspace. A record for another profile is left to age out instead of
 * being shown, and one older than {@link STORED_HANDOFF_ERROR_TTL_MS} is
 * discarded.
 */
export async function takeStoredAuthHandoffError(
  store: CookieStore,
  currentServer?: string,
  now: number = Date.now(),
): Promise<string | null> {
  const raw = await store.getItem(HANDOFF_ERROR_KEY);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await store.removeItem(HANDOFF_ERROR_KEY);
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    await store.removeItem(HANDOFF_ERROR_KEY);
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
    await store.removeItem(HANDOFF_ERROR_KEY);
    return null;
  }
  if (record.at + STORED_HANDOFF_ERROR_TTL_MS <= now) {
    await store.removeItem(HANDOFF_ERROR_KEY);
    return null;
  }
  const activeServer = currentServer === undefined ? null : originOf(currentServer);
  if (activeServer === null || activeServer !== record.server) {
    return null;
  }
  await store.removeItem(HANDOFF_ERROR_KEY);
  return record.message;
}

/** Drops a stored callback failure after a successful sign-in. */
export async function clearStoredAuthHandoffError(store: CookieStore): Promise<void> {
  await store.removeItem(HANDOFF_ERROR_KEY);
}

/**
 * Displays the one late callback a client may accept without a pending record:
 * an `auth_expired` redirect that carries a well-formed `tx` and names the
 * workspace this app is currently using. It only stores the message for the
 * sign-in screen; it never completes a sign-in, clears another flow, or accepts
 * any other error or code.
 */
export async function storeExpiredWithoutPending(
  store: CookieStore,
  params: AuthRedirectParams,
  currentServer: string | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (params.error !== NATIVE_AUTH_EXPIRED_ERROR) {
    return false;
  }
  if (!isAuthTransactionId(params.tx)) {
    return false;
  }
  if (params.server === undefined || currentServer === undefined) {
    return false;
  }
  const errorServer = originOf(params.server);
  if (errorServer === null || errorServer !== originOf(currentServer)) {
    return false;
  }
  if ((await readPendingAuthHandoff(store, now)) !== null) {
    return false;
  }
  await storeAuthHandoffError(
    store,
    providerSignInErrorMessage(NATIVE_AUTH_EXPIRED_ERROR),
    errorServer,
  );
  return true;
}

/**
 * Returns the pending transaction only when an untrusted callback names both
 * the workspace this install started signing in to and the transaction id this
 * install minted. A missing tx (an older server), another workspace's origin,
 * or no pending transaction is not a match.
 */
export async function matchingPendingAuthHandoff(
  store: CookieStore,
  server: string | undefined,
  tx: string | undefined,
  now: number = Date.now(),
): Promise<PendingAuthHandoff | null> {
  if (server === undefined || !isAuthTransactionId(tx)) {
    return null;
  }
  const pending = await readPendingAuthHandoff(store, now);
  if (pending === null || pending.tx !== tx) {
    return null;
  }
  return originOf(server) === pending.server ? pending : null;
}

export type AuthRedirectResult =
  | { readonly status: "success" }
  | { readonly status: "error"; readonly error: string }
  /** Not this install's sign-in: leave the pending transaction untouched. */
  | { readonly status: "ignored" };

/**
 * Applies one callback URL to the pending transaction.
 *
 * Matching the workspace origin alone is not authentication: only a redirect
 * that echoes the client-minted `tx` may finish or cancel this sign-in. A
 * mismatch is ignored completely — the pending row is not cleared, so a forged
 * error link or code cannot stop the real flow.
 */
export async function completeAuthRedirect(
  store: CookieStore,
  params: AuthRedirectParams,
  exchange: (server: string, code: string, verifier: string) => Promise<string | null>,
  now: number = Date.now(),
): Promise<AuthRedirectResult> {
  const pending = await matchingPendingAuthHandoff(store, params.server, params.tx, now);
  if (pending === null) {
    return { status: "ignored" };
  }
  if (params.error !== undefined) {
    await clearPendingAuthHandoff(store);
    return { status: "error", error: params.error };
  }
  if (params.code === undefined || params.code.length === 0) {
    return { status: "ignored" };
  }
  await clearPendingAuthHandoff(store);
  const token = await exchange(pending.server, params.code, pending.verifier);
  if (token === null) {
    return { status: "error", error: "auth_failed" };
  }
  await storeAuthToken(store, pending.server, token);
  return { status: "success" };
}

/** Trades a workspace handoff code for a bearer session token. */
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
 * Runs one exchange operation under a hard deadline. The operation covers the
 * fetch *and* reading the body: a workspace that sends headers and then stalls
 * the body must time out too. Racing the timeout (instead of only aborting the
 * request) also covers a fetch implementation that ignores the signal.
 */
async function withExchangeDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AuthExchangeTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function exchangeAuthCode(
  siteUrl: string,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs: number = AUTH_EXCHANGE_TIMEOUT_MS,
): Promise<string | null> {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return await withExchangeDeadline(timeoutMs, async (signal) => {
    const response = await fetchImpl(`${base}/api/auth/native/exchange`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || !("token" in data)) {
      return null;
    }
    const token = (data as { token?: unknown }).token;
    return typeof token === "string" && token.length > 0 ? token : null;
  });
}

/** Stores the token under the workspace that issued it. */
export async function storeAuthToken(
  store: CookieStore,
  siteUrl: string,
  token: string,
): Promise<boolean> {
  await store.setItem(authTokenKey(siteUrl), token);
  return true;
}
