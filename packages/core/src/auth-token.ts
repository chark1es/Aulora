/**
 * Resilience for the Convex access token that Better Auth mints.
 *
 * Convex asks the auth integration for a token with
 * `fetchAccessToken({ forceRefreshToken })`: on mount, and again shortly before
 * the JWT expires (15 minutes by default; see
 * `packages/convex/convex/auth.ts`). Everything the integration returns is
 * interpreted as an authentication fact by `ConvexProviderWithAuth`:
 *
 * - a token string means "signed in" (the server then confirms it),
 * - `null` means "there is no session" and makes the client report
 *   `isAuthenticated: false`.
 *
 * A failed HTTP request is not a sign-out. A short outage of `/api/auth/*`
 * (a proxy restart, a laptop waking up, a flaky network) must leave the last
 * confirmed session in place instead of flipping the whole app to signed out —
 * that flip unmounts the chat surface and drops a call. This helper keeps the
 * last token it was given and only reports `null` when the auth server
 * definitively rejects the session (a 401), or when no token was ever issued.
 *
 * The fallback is deliberately bounded. It is never served after its own JWT
 * `exp` (decoded, not verified) and covers at most one proactive-refresh cycle
 * of transient failures; past that the failure is surfaced so the existing
 * recovery UI can offer a reconnect or rebuild. The cache is bound to the
 * Better Auth session/user id: a different identity, or an explicit sign-out,
 * drops it before another request can replay someone else's token.
 *
 * The helper is deliberately free of React and Better Auth imports so both the
 * web and native clients can share it and it can be unit-tested on its own.
 */

import { base64UrlToBytes, utf8Decode } from "./binary";

/** The shape Better Auth's `convex.token()` call resolves to. */
export interface ConvexTokenResponse {
  readonly data?: { readonly token?: string } | null;
  readonly error?: unknown;
}

/**
 * Options every Convex client in this repo should be created with.
 *
 * - `authRefreshTokenLeewaySeconds`: refresh a minute before the (15-minute)
 *   JWT expires instead of the default ten seconds, so a briefly throttled or
 *   offline tab still rotates in time.
 * - `initialAuthTokenReuse`: after the socket confirms the token it already
 *   presented, keep it instead of fetching a second one. The second fetch
 *   re-authenticated every query for a new identity on every page load.
 */
export const CONVEX_AUTH_CLIENT_OPTIONS = {
  authRefreshTokenLeewaySeconds: 60,
  initialAuthTokenReuse: true,
} as const;

export interface ProviderTokenFetcherOptions {
  /** Attempts per call before falling back to the last token. Default 2. */
  readonly attempts?: number;
  /** Whether an error means the server rejected the session. Default: 401. */
  readonly isRejection?: (_error: unknown) => boolean;
  /**
   * Consecutive calls that may be answered from the cache after the token
   * endpoint failed. Default 1: enough to cover the single proactive refresh
   * before expiry, not enough to hide a long outage.
   */
  readonly maxFallbacks?: number;
  /** Clock override for tests. */
  readonly now?: () => number;
}

export interface ProviderTokenFetcher {
  (_options?: unknown): Promise<ConvexTokenResponse>;
  /** The last token handed to the client, or `null` before the first success. */
  lastToken(): string | null;
  /**
   * Drops the cached token synchronously. Call it on explicit sign-out, and
   * whenever the auth client or server profile is replaced.
   */
  reset(): void;
  /**
   * Binds the cache to the Better Auth session/user id. A different id (user A
   * to user B) drops the cached token; `null` means "no session" and also
   * clears it.
   */
  setIdentity(_identity: string | null): void;
}

/** `true` when the error is Better Auth's definitive "no session" answer. */
export function isTokenRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 401
  );
}

function issuedToken(response: ConvexTokenResponse | undefined): string | null {
  const token = response?.data?.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Reads a JWT payload without verifying its signature. */
function tokenClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload: unknown = JSON.parse(utf8Decode(base64UrlToBytes(parts[1] ?? "")));
    return typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads a JWT's expiry without verifying the signature. Verification belongs
 * to the server; the client only needs to know whether replaying a cached
 * token could possibly authenticate anyone. Returns `null` for a token whose
 * `exp` cannot be read (an opaque or malformed token), which the fallback then
 * treats as not time-limited.
 */
export function tokenExpiryMs(token: string): number | null {
  const exp = tokenClaims(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1_000 : null;
}

/**
 * Reads a JWT's subject without verifying the signature. Better Auth sets it
 * to the user id, which is the part of the cache identity that must match when
 * a token fetched before session discovery is adopted. Returns `null` for an
 * opaque or malformed token, or one without a usable `sub`.
 */
export function tokenSubject(token: string): string | null {
  const sub = tokenClaims(token)?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/**
 * The user id inside a cache identity. Web identities are
 * `sessionId:userId`; native ones are the bare user id. Tokens carry the user
 * id as `sub`, so only that part can be compared.
 */
function userIdFromIdentity(identity: string): string {
  const separator = identity.indexOf(":");
  return separator === -1 ? identity : identity.slice(separator + 1);
}

/** Whether a token's subject is the user the cache is now bound to. */
function tokenMatchesIdentity(token: string, identity: string): boolean {
  const subject = tokenSubject(token);
  return subject !== null && subject === userIdFromIdentity(identity);
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number | null;
  /** The session/user id the token was issued under, when known. */
  identity: string | null;
}

/**
 * Wraps one `convex.token()` call with the bounded last-token fallback.
 *
 * Returns a function with the same contract, so it can be dropped into an auth
 * client in place of the original method.
 */
export function createProviderTokenFetcher(
  fetchToken: (_options?: unknown) => Promise<ConvexTokenResponse>,
  options: ProviderTokenFetcherOptions = {},
): ProviderTokenFetcher {
  const attempts = Math.max(1, options.attempts ?? 2);
  const isRejection = options.isRejection ?? isTokenRejection;
  const maxFallbacks = Math.max(0, options.maxFallbacks ?? 1);
  const now = options.now ?? Date.now;
  let cached: CachedToken | null = null;
  let identity: string | null = null;
  let fallbacks = 0;
  /**
   * Bumped whenever the cache is dropped or an already-known identity is
   * replaced. A request captures it before awaiting the token endpoint so an
   * answer that arrives after sign-out or an account switch cannot be cached or
   * replayed under the identity that is current now.
   */
  let generation = 0;

  const reset = (): void => {
    cached = null;
    fallbacks = 0;
    generation += 1;
  };

  const setIdentity = (next: string | null): void => {
    if (next === null) {
      identity = null;
      reset();
      return;
    }
    if (next === identity) {
      return;
    }
    const previous = identity;
    if (previous === null) {
      // The session was not known yet. A request that started without an
      // identity has no older account to leak, so it may still be adopted
      // below instead of being invalidated. This is the boot path: the first
      // token fetch usually starts before `useSession` resolves.
      //
      // "Unknown identity" is not "no account", though: the token endpoint may
      // have been asked with A's session cookie while discovery now names B.
      // Adopting such a token would cache and replay A's session as B, so the
      // token's own subject must match the adopted user id. A token without a
      // readable subject cannot prove whose it is either.
      if (cached !== null && cached.identity === null) {
        if (tokenMatchesIdentity(cached.token, next)) {
          cached.identity = next;
        } else {
          reset();
        }
      }
      identity = next;
      return;
    }
    if (cached !== null && cached.identity !== null && cached.identity !== next) {
      // A different account: clearing also invalidates any request that was
      // already in flight for the previous identity.
      reset();
    } else {
      if (cached !== null && cached.identity === null) {
        cached.identity = next;
      }
      generation += 1;
    }
    identity = next;
  };

  const usableFallback = (): CachedToken | null => {
    if (cached === null) {
      return null;
    }
    if (cached.identity !== identity) {
      return null;
    }
    if (cached.expiresAt !== null && cached.expiresAt <= now()) {
      return null;
    }
    if (fallbacks >= maxFallbacks) {
      return null;
    }
    return cached;
  };

  const fetcher = async (fetchOptions?: unknown): Promise<ConvexTokenResponse> => {
    const startedAt = generation;
    const startedIdentity = identity;
    let response: ConvexTokenResponse | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        response = await fetchToken(fetchOptions);
      } catch {
        response = undefined;
      }
      if (generation !== startedAt) {
        // The cache was cleared or rebound while this request was in flight.
        // The answer belongs to the identity that started the request, so it
        // must not be cached and must not be replayed as the current one.
        return { data: null, error: { status: 0 } };
      }
      const token = issuedToken(response);
      if (token !== null) {
        // This request started before session discovery named an account. If
        // an identity was adopted while it was in flight, its answer is only
        // usable when the token itself names that user. Otherwise it belongs
        // to whatever session the request was made with — discard it and bump
        // the generation so the next call refetches instead of replaying it.
        if (
          startedIdentity === null &&
          identity !== null &&
          !tokenMatchesIdentity(token, identity)
        ) {
          reset();
          return { data: null, error: { status: 0 } };
        }
        cached = {
          token,
          expiresAt: tokenExpiryMs(token),
          identity,
        };
        fallbacks = 0;
        return response as ConvexTokenResponse;
      }
      // A rejection is final: the session is gone, so the stored token must not
      // be replayed. Anything else is an outage and is worth one more attempt.
      if (response !== undefined && isRejection(response.error)) {
        reset();
        return response;
      }
    }
    const fallback = usableFallback();
    if (fallback !== null) {
      fallbacks += 1;
      return { data: { token: fallback.token }, error: null };
    }
    return response ?? { data: null, error: { status: 0 } };
  };

  return Object.assign(fetcher, {
    lastToken: () => cached?.token ?? null,
    reset,
    setIdentity,
  });
}
