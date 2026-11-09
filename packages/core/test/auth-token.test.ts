import { describe, expect, it, vi } from "vitest";
import {
  type ConvexTokenResponse,
  createProviderTokenFetcher,
  isTokenRejection,
  tokenExpiryMs,
} from "../src/auth-token";

/**
 * Convex treats `null` from the token fetcher as "signed out". A failed HTTP
 * call must therefore hand back the last token instead of signing the person
 * out; only a 401 from the auth server, an expired token, or an outage that
 * outlasts the bounded fallback may end the session.
 */

function rejected(): ConvexTokenResponse {
  return { data: null, error: { status: 401, message: "Invalid session" } };
}

function transient(): ConvexTokenResponse {
  return { data: null, error: { status: 503 } };
}

/** Builds an unsigned JWT-shaped token with a real `exp` (and optional `sub`). */
function jwt(expSeconds: number, sub?: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = sub === undefined ? { exp: expSeconds } : { exp: expSeconds, sub };
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

const FUTURE = 1_800_000_000;

describe("createProviderTokenFetcher", () => {
  it("returns and remembers a freshly issued token", async () => {
    const fetchToken = vi.fn(async () => ({ data: { token: "jwt-1" } }));
    const fetcher = createProviderTokenFetcher(fetchToken);

    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual({
      data: { token: "jwt-1" },
    });
    expect(fetcher.lastToken()).toBe("jwt-1");
  });

  it("rides out one transient failure", async () => {
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValueOnce({ data: { token: "jwt-2" } });
    const fetcher = createProviderTokenFetcher(fetchToken);

    await expect(fetcher()).resolves.toEqual({ data: { token: "jwt-2" } });
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("keeps the last token when the auth endpoint stays unreachable", async () => {
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } });
    const fetcher = createProviderTokenFetcher(fetchToken);
    await fetcher();

    fetchToken.mockRejectedValue(new Error("Failed to fetch"));
    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual({
      data: { token: "jwt-1" },
      error: null,
    });
    expect(fetcher.lastToken()).toBe("jwt-1");
  });

  it("refuses to replay a cached token after its own expiry", async () => {
    const now = 1_800_000_000_000;
    const token = jwt(now / 1_000 + 60);
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token } })
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken, { now: () => now });

    await fetcher();
    // A refresh one minute before `exp` is still served from the cache...
    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual({
      data: { token },
      error: null,
    });

    // ...but once the JWT itself has expired, an outage must surface instead of
    // reporting an authenticated session the server cannot accept.
    const laterFetch = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token } })
      .mockResolvedValue(transient());
    const later = createProviderTokenFetcher(laterFetch, {
      now: () => now + 120_000,
    });
    await later();
    await expect(later({ forceRefreshToken: true })).resolves.toEqual({
      data: null,
      error: { status: 503 },
    });
  });

  it("stops falling back after one refresh cycle", async () => {
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } })
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken);
    await fetcher();

    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual({
      data: { token: "jwt-1" },
      error: null,
    });
    // A second refresh in a row means the outage outlasted the window the
    // fallback covers; the failure must reach `SessionGate` recovery.
    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual(transient());
  });

  it("clears the cached token synchronously on reset", async () => {
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } })
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken);
    await fetcher();

    fetcher.reset();
    expect(fetcher.lastToken()).toBeNull();
    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual(transient());
  });

  it("discards an in-flight token that resolves after a sign-out reset", async () => {
    let resolveToken!: (value: ConvexTokenResponse) => void;
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken);
    fetcher.setIdentity("user-a");

    const inFlight = fetcher();
    // The person signs out while the token endpoint has not answered yet.
    fetcher.reset();
    resolveToken({ data: { token: "jwt-a" } });

    // The late answer belongs to the identity that requested it: it is neither
    // cached nor handed back as the current session.
    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(fetcher.lastToken()).toBeNull();
    await expect(fetcher()).resolves.toEqual(transient());
  });

  it("does not replay an in-flight token from the account that left", async () => {
    let resolveA!: (value: ConvexTokenResponse) => void;
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken);

    fetcher.setIdentity("user-a");
    const inFlightA = fetcher();
    fetcher.setIdentity("user-b");

    // User B's own request fails while A's is still in flight. The outage must
    // surface; A's token is not a fallback B may use.
    await expect(fetcher()).resolves.toEqual(transient());
    expect(fetcher.lastToken()).toBeNull();

    // A's late answer arrives: discard it instead of caching it under B.
    resolveA({ data: { token: "jwt-a" } });
    await expect(inFlightA).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(fetcher.lastToken()).toBeNull();
    await expect(fetcher()).resolves.toEqual(transient());
  });

  it("keeps working for concurrent requests under the same identity", async () => {
    let resolveA!: (value: ConvexTokenResponse) => void;
    let resolveB!: (value: ConvexTokenResponse) => void;
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          }),
      );
    const fetcher = createProviderTokenFetcher(fetchToken);
    fetcher.setIdentity("user-a");

    const first = fetcher();
    const second = fetcher();

    resolveB({ data: { token: "jwt-b" } });
    await expect(second).resolves.toEqual({ data: { token: "jwt-b" } });
    resolveA({ data: { token: "jwt-a" } });
    await expect(first).resolves.toEqual({ data: { token: "jwt-a" } });
    expect(fetcher.lastToken()).toBe("jwt-a");
  });

  it("adopts a boot token whose subject matches the resolved user", async () => {
    const token = jwt(FUTURE, "user-a");
    let resolveToken!: (value: ConvexTokenResponse) => void;
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken);

    // The first boot fetch starts before `useSession` names the account.
    const inFlight = fetcher();
    fetcher.setIdentity("session-1:user-a");
    resolveToken({ data: { token } });

    await expect(inFlight).resolves.toEqual({ data: { token } });
    expect(fetcher.lastToken()).toBe(token);
  });

  it("does not adopt a boot token issued for another user", async () => {
    const tokenA = jwt(FUTURE, "user-a");
    const tokenB = jwt(FUTURE, "user-b");
    let resolveToken!: (value: ConvexTokenResponse) => void;
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue({ data: { token: tokenB } });
    const fetcher = createProviderTokenFetcher(fetchToken);

    // A token request ran with A's session cookie while discovery resolves B.
    const inFlight = fetcher();
    fetcher.setIdentity("session-b:user-b");
    resolveToken({ data: { token: tokenA } });

    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(fetcher.lastToken()).toBeNull();

    // The discard bumped the generation, so the next call refetches and only
    // then caches B's own token.
    await expect(fetcher()).resolves.toEqual({ data: { token: tokenB } });
    expect(fetcher.lastToken()).toBe(tokenB);
  });

  it("does not adopt a cached token issued for another user", async () => {
    const tokenA = jwt(FUTURE, "user-a");
    const tokenB = jwt(FUTURE, "user-b");
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token: tokenA } })
      .mockResolvedValue({ data: { token: tokenB } });
    const fetcher = createProviderTokenFetcher(fetchToken);

    // The answer landed before session discovery named the account.
    await fetcher();
    expect(fetcher.lastToken()).toBe(tokenA);

    fetcher.setIdentity("session-b:user-b");
    expect(fetcher.lastToken()).toBeNull();
    await expect(fetcher()).resolves.toEqual({ data: { token: tokenB } });
    expect(fetcher.lastToken()).toBe(tokenB);
  });

  it("refetches instead of adopting a boot token without a readable subject", async () => {
    const tokenB = jwt(FUTURE, "user-b");
    let resolveToken!: (value: ConvexTokenResponse) => void;
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue({ data: { token: tokenB } });
    const fetcher = createProviderTokenFetcher(fetchToken);

    const inFlight = fetcher();
    fetcher.setIdentity("user-b");
    resolveToken({ data: { token: "opaque-token" } });

    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(fetcher.lastToken()).toBeNull();
    await expect(fetcher()).resolves.toEqual({ data: { token: tokenB } });
    expect(fetcher.lastToken()).toBe(tokenB);
  });

  it("drops the cached token when the session identity changes", async () => {
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(transient());
    const fetcher = createProviderTokenFetcher(fetchToken);

    fetcher.setIdentity("user-a");
    await fetcher();
    expect(fetcher.lastToken()).toBe("jwt-a");

    // User A signed out and user B signed in on the same client while the token
    // endpoint is failing: B must not be handed A's token.
    fetcher.setIdentity("user-b");
    expect(fetcher.lastToken()).toBeNull();
    await expect(fetcher({ forceRefreshToken: true })).resolves.toEqual(transient());
  });

  it("reports a definitive rejection and forgets the token", async () => {
    const fetchToken = vi
      .fn<() => Promise<ConvexTokenResponse>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } })
      .mockResolvedValueOnce(rejected());
    const fetcher = createProviderTokenFetcher(fetchToken);
    await fetcher();

    await expect(fetcher()).resolves.toEqual(rejected());
    expect(fetcher.lastToken()).toBeNull();
  });

  it("reports the failure when no token was ever issued", async () => {
    const fetchToken = vi.fn(async () => ({ data: null, error: { status: 503 } }));
    const fetcher = createProviderTokenFetcher(fetchToken);

    await expect(fetcher()).resolves.toEqual({ data: null, error: { status: 503 } });
    expect(fetcher.lastToken()).toBeNull();
  });
});

describe("tokenExpiryMs", () => {
  it("reads `exp` without verifying the signature", () => {
    expect(tokenExpiryMs(jwt(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it("returns null for opaque or malformed tokens", () => {
    expect(tokenExpiryMs("jwt-1")).toBeNull();
    expect(tokenExpiryMs("a.b.c")).toBeNull();
    expect(tokenExpiryMs("a.!!!.c")).toBeNull();
  });
});

describe("isTokenRejection", () => {
  it("accepts only a 401", () => {
    expect(isTokenRejection({ status: 401 })).toBe(true);
    expect(isTokenRejection({ status: 403 })).toBe(false);
    expect(isTokenRejection(new Error("Failed to fetch"))).toBe(false);
    expect(isTokenRejection(null)).toBe(false);
  });
});
