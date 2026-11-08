import { describe, expect, it } from "vitest";
import { completeAuthCallback, decodeAuthCookieParam } from "../src/lib/auth-callback";
import { AUTH_COOKIE_KEY, type CookieStore } from "../src/lib/cookie-fetch";

function memoryStore(overrides: Partial<CookieStore> = {}): {
  store: CookieStore;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
      ...overrides,
    },
  };
}

describe("decodeAuthCookieParam", () => {
  it("decodes a percent-encoded cookie", () => {
    expect(decodeAuthCookieParam("better-auth.session_token%3Dabc")).toBe(
      "better-auth.session_token=abc",
    );
  });

  it("keeps a malformed escape verbatim instead of throwing", () => {
    // `decodeURIComponent` throws `URIError` on these; the callback screen used
    // to reject before navigating away, leaving "Completing sign-in…" up forever.
    expect(decodeAuthCookieParam("%ZZ")).toBe("%ZZ");
    expect(decodeAuthCookieParam("better-auth.session_token=abc%")).toBe(
      "better-auth.session_token=abc%",
    );
  });

  it("returns null for a blank parameter", () => {
    expect(decodeAuthCookieParam("   ")).toBeNull();
  });
});

describe("completeAuthCallback", () => {
  it("stores the cookie carried by the redirect parameter", async () => {
    const { store, map } = memoryStore();
    const stored = await completeAuthCallback(store, {
      cookie: "better-auth.session_token%3Dtoken",
      initialUrl: async () => "aulora://auth/callback?cookie=ignored",
    });

    expect(stored).toBe(true);
    expect(map.get(AUTH_COOKIE_KEY)).toBe("better-auth.session_token=token");
  });

  it("falls back to the launch URL when the parameter is absent", async () => {
    const { store, map } = memoryStore();
    const stored = await completeAuthCallback(store, {
      cookie: undefined,
      initialUrl: async () => "aulora://auth/callback?cookie=better-auth.session_token%3Dfromurl",
    });

    expect(stored).toBe(true);
    expect(map.get(AUTH_COOKIE_KEY)).toBe("better-auth.session_token=fromurl");
  });

  it("resolves when the cookie is malformed and there is no launch URL", async () => {
    const { store } = memoryStore();

    // Never rejects: the route can always navigate away from the spinner.
    await expect(
      completeAuthCallback(store, { cookie: "%E0%A4%A", initialUrl: async () => null }),
    ).resolves.toBe(true);
    await expect(
      completeAuthCallback(store, { cookie: "   ", initialUrl: async () => null }),
    ).resolves.toBe(false);
  });

  it("resolves when the launch URL cannot be read", async () => {
    const { store } = memoryStore();

    await expect(
      completeAuthCallback(store, {
        cookie: undefined,
        initialUrl: async () => {
          throw new Error("linking is unavailable");
        },
      }),
    ).resolves.toBe(false);
  });

  it("resolves when the cookie store rejects", async () => {
    const { store } = memoryStore({
      setItem: async () => {
        throw new Error("container unavailable");
      },
    });

    await expect(
      completeAuthCallback(store, { cookie: "a=b", initialUrl: async () => null }),
    ).resolves.toBe(false);
  });
});
