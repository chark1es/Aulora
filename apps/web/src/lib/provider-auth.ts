/**
 * The auth client handed to `ConvexBetterAuthProvider`, with the token call
 * made outage-tolerant.
 *
 * The provider asks for a JWT on mount and before every expiry. Its adapter
 * treats a `null` answer as "the person signed out" and reports the Convex
 * client unauthenticated, which `SessionGate` may answer by rebuilding the
 * whole client pair (and remounting the chat surface and any call). A failed
 * HTTP request is not a sign-out, so the wrapped `convex.token` keeps the last
 * issued token until the auth server actually rejects the session, the token's
 * own expiry passes, or the outage outlasts one refresh cycle. See
 * `@aulora/core`'s `createProviderTokenFetcher`.
 *
 * The cache is bound to one Better Auth session: sign-out and a user/session id
 * change clear it synchronously, so a later transient failure cannot replay the
 * previous account's token. `authActionsFromClient` calls
 * {@link resetProviderToken} on every sign-out path.
 */

import { createProviderTokenFetcher, type ProviderTokenFetcher } from "@aulora/core";
import type { AuloraAuthClient } from "./auth-client";

export interface ProviderAuth {
  /** Drop-in replacement for the client passed to the Convex auth provider. */
  readonly client: AuloraAuthClient;
  /** The last token handed to Convex, or `null` before the first one. */
  lastToken(): string | null;
  /** Drops the cached token synchronously (explicit sign-out). */
  reset(): void;
  /** Binds the cache to the Better Auth session/user id. */
  setIdentity(_identity: string | null): void;
}

/**
 * One entry per `convex.token` wrapper created for a raw auth client. A sign-out
 * happens on the raw client (the UI never holds the proxy), so it needs a way
 * back to the cache the provider is using.
 */
const fetchers = new WeakMap<AuloraAuthClient, Set<ProviderTokenFetcher>>();

function register(client: AuloraAuthClient, fetcher: ProviderTokenFetcher): void {
  const existing = fetchers.get(client);
  if (existing === undefined) {
    fetchers.set(client, new Set([fetcher]));
    return;
  }
  existing.add(fetcher);
}

/** Clears every Convex token cached for this auth client. */
export function resetProviderToken(client: AuloraAuthClient): void {
  for (const fetcher of fetchers.get(client) ?? []) {
    fetcher.reset();
  }
}

/** Re-binds every Convex token cache for this auth client to an identity. */
export function setProviderTokenIdentity(client: AuloraAuthClient, identity: string): void {
  for (const fetcher of fetchers.get(client) ?? []) {
    fetcher.setIdentity(identity);
  }
}

export function createProviderAuth(client: AuloraAuthClient): ProviderAuth {
  const fetchToken = createProviderTokenFetcher((options) => client.convex.token(options as never));
  register(client, fetchToken);
  const wrapped = new Proxy(client, {
    get(target, property) {
      if (property === "convex") {
        return { token: fetchToken };
      }
      // Resolve against the target, not the proxy, so the dynamic client's own
      // property traps keep working exactly as before.
      return Reflect.get(target, property, target);
    },
  }) as AuloraAuthClient;
  return {
    client: wrapped,
    lastToken: fetchToken.lastToken,
    reset: fetchToken.reset,
    setIdentity: fetchToken.setIdentity,
  };
}
