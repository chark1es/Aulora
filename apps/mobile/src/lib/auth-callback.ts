import {
  type AuthRedirectParams,
  clearPendingAuthHandoff,
  clearStoredAuthHandoffError,
  completeAuthRedirect,
  exchangeAuthCode,
  isAuthExchangeTimeout,
  providerSignInErrorMessage,
  readAuthRedirectParams,
  storeAuthHandoffError,
  storeExpiredWithoutPending,
} from "./auth-handoff";
import type { CookieStore } from "./cookie-fetch";

/**
 * Completes a native OAuth callback.
 *
 * A deep link is untrusted input: it may carry a short-lived handoff code or an
 * allowlisted error code. The workspace session is obtained by exchanging that
 * code with the verifier this install kept when it started sign-in. A session
 * cookie is never accepted from a link (that would let anyone sign a device into
 * the attacker's account with a crafted `aulora://auth/callback?cookie=...`).
 */

export interface AuthCallbackInput {
  /** The handoff code from the deep link, when the workspace issued one. */
  readonly code?: string | undefined;
  /** The workspace origin that issued the handoff code. */
  readonly server?: string | undefined;
  /** The transaction id the workspace echoed from this install's start. */
  readonly tx?: string | undefined;
  /** An allowlisted provider error the finish route sent back instead of a code. */
  readonly error?: string | undefined;
  /** Reads the launch URL, used when the parameters are absent. */
  readonly initialUrl: () => Promise<string | null>;
  /** Injectable for tests; defaults to the real exchange request. */
  readonly exchange?: (server: string, code: string, verifier: string) => Promise<string | null>;
  /** This app's active workspace, used only for a late `auth_expired` message. */
  readonly currentServer?: string | undefined;
}

/** One in-flight callback per resolved link, so duplicate route runs share it. */
const inFlightCallbacks = new Map<string, Promise<boolean>>();

function callbackKey(params: AuthRedirectParams): string {
  return [params.server ?? "", params.tx ?? "", params.code ?? "", params.error ?? ""].join("|");
}

async function applyAuthCallback(
  store: CookieStore,
  params: AuthRedirectParams,
  input: AuthCallbackInput,
): Promise<boolean> {
  const exchange = input.exchange ?? exchangeAuthCode;
  const result = await completeAuthRedirect(store, params, exchange);
  if (result.status === "error") {
    // The pending transaction is already cleared; leave the explainable
    // message for the sign-in screen instead of silently returning.
    await storeAuthHandoffError(
      store,
      providerSignInErrorMessage(result.error),
      params.server ?? "",
    ).catch(() => undefined);
  } else if (result.status === "ignored") {
    // The local pending record can lapse before the server transaction does.
    // Keep that one late `auth_expired` answer showable, but only when it
    // names this app's current workspace and a well-formed transaction.
    await storeExpiredWithoutPending(store, params, input.currentServer).catch(() => undefined);
  } else {
    // A completed sign-in must not leave an older failure on the next screen.
    await clearStoredAuthHandoffError(store).catch(() => undefined);
  }
  return result.status === "success";
}

/**
 * Persists the session carried by a native auth redirect.
 *
 * Never rejects. The caller's only job afterwards is to leave the callback
 * screen, and a storage or link-read failure that rejected here would strand
 * the app on "Completing sign-in…" forever with no way back.
 *
 * The route's effect can run more than once while its params arrive late. Runs
 * that resolve to the same link share one in-flight operation, so the loser
 * cannot exchange a consumed code a second time and store a spurious failure.
 */
export async function completeAuthCallback(
  store: CookieStore,
  input: AuthCallbackInput,
): Promise<boolean> {
  let params: AuthRedirectParams | null = null;
  try {
    if (
      input.code !== undefined ||
      input.server !== undefined ||
      input.tx !== undefined ||
      input.error !== undefined
    ) {
      params = { code: input.code, server: input.server, tx: input.tx, error: input.error };
    } else {
      const url = await input.initialUrl();
      if (url === null) {
        return false;
      }
      params = readAuthRedirectParams(url);
    }
    if (params === null) {
      return false;
    }
    const key = callbackKey(params);
    const existing = inFlightCallbacks.get(key);
    if (existing !== undefined) {
      return await existing;
    }
    const task = applyAuthCallback(store, params, input);
    inFlightCallbacks.set(key, task);
    try {
      return await task;
    } finally {
      inFlightCallbacks.delete(key);
    }
  } catch (error) {
    if (isAuthExchangeTimeout(error)) {
      // The exchange already consumed the pending transaction; clearing again is
      // harmless and keeps the invariant if a custom exchange failed earlier.
      await clearPendingAuthHandoff(store).catch(() => undefined);
      await storeAuthHandoffError(
        store,
        "Sign-in timed out, please try again",
        params?.server ?? input.server ?? input.currentServer ?? "",
      ).catch(() => undefined);
    }
    return false;
  }
}
