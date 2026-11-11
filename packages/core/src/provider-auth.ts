import { createProviderTokenFetcher, type ProviderTokenFetcher } from "./auth-token";

interface TokenClient {
  readonly convex: {
    token(options: never): ReturnType<Parameters<typeof createProviderTokenFetcher>[0]>;
  };
}

export interface ProviderAuth<T extends object> {
  /** Drop-in replacement for the client passed to the Convex auth provider. */
  readonly client: T;
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
const fetchers = new WeakMap<object, Set<ProviderTokenFetcher>>();

function register<T extends object>(client: T, fetcher: ProviderTokenFetcher): void {
  const existing = fetchers.get(client);
  if (existing === undefined) {
    fetchers.set(client, new Set([fetcher]));
    return;
  }
  existing.add(fetcher);
}

/** Clears every Convex token cached for this auth client. */
export function resetProviderToken(client: object): void {
  for (const fetcher of fetchers.get(client) ?? []) {
    fetcher.reset();
  }
}

/** Re-binds every Convex token cache for this auth client to an identity. */
export function setProviderTokenIdentity(client: object, identity: string): void {
  for (const fetcher of fetchers.get(client) ?? []) {
    fetcher.setIdentity(identity);
  }
}

export function createProviderAuth<T extends TokenClient>(client: T): ProviderAuth<T> {
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
  }) as T;
  return {
    client: wrapped,
    lastToken: fetchToken.lastToken,
    reset: fetchToken.reset,
    setIdentity: fetchToken.setIdentity,
  };
}
