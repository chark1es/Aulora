import { describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE_KEY,
  type CookieStore,
  createCookieFetch,
  mergeCookieHeader,
  readSetCookies,
  storeRedirectCookie,
} from "../src/lib/cookie-fetch";

function memoryCookieStore(): { store: CookieStore; map: Map<string, string> } {
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
    },
  };
}

describe("mergeCookieHeader", () => {
  it("adds, updates and deletes cookies", () => {
    expect(mergeCookieHeader(null, ["a=1", "b=2"])).toBe("a=1; b=2");
    expect(mergeCookieHeader("a=1; b=2", ["a=9"])).toBe("a=9; b=2");
    expect(mergeCookieHeader("a=1; b=2", ["a="])).toBe("b=2");
  });
});

describe("readSetCookies", () => {
  it("prefers getSetCookie and falls back to a combined header", () => {
    const withGetter = new Headers();
    (withGetter as unknown as { getSetCookie: () => string[] }).getSetCookie = () => ["a=1", "b=2"];
    expect(readSetCookies(withGetter)).toEqual(["a=1", "b=2"]);

    const combined = new Headers({ "set-cookie": "a=1, b=2; Path=/" });
    (combined as unknown as { getSetCookie?: unknown }).getSetCookie = undefined;
    expect(readSetCookies(combined)).toEqual(["a=1", "b=2; Path=/"]);
  });

  it("splits combined cookies whose names contain a dot", () => {
    const combined = new Headers({
      "set-cookie":
        "better-auth.session_token=abc; Path=/; HttpOnly, better-auth.convex_jwt=def; Path=/",
    });
    (combined as unknown as { getSetCookie?: unknown }).getSetCookie = undefined;
    expect(readSetCookies(combined)).toEqual([
      "better-auth.session_token=abc; Path=/; HttpOnly",
      "better-auth.convex_jwt=def; Path=/",
    ]);
  });
});

describe("createCookieFetch", () => {
  it("sends the stored cookie and persists set-cookie responses", async () => {
    const { store, map } = memoryCookieStore();
    const seen: Array<string | null> = [];
    const credentials: Array<RequestCredentials | undefined> = [];
    const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("cookie"));
      credentials.push(init?.credentials);
      const headers = new Headers({ "set-cookie": "session=abc; HttpOnly; Path=/" });
      return new Response("{}", { status: 200, headers });
    });
    const cookieFetch = createCookieFetch({
      store,
      baseFetch: baseFetch as unknown as typeof fetch,
    });

    await cookieFetch("https://chat.acme.com/api/auth/get-session");
    expect(map.get(AUTH_COOKIE_KEY)).toContain("session=abc");
    expect(seen[0]).toBeNull();

    await cookieFetch("https://chat.acme.com/api/auth/convex/token");
    expect(seen[1]).toBe("session=abc");
    // The platform cookie jar must stay out, or iOS sends the session twice.
    expect(credentials).toEqual(["omit", "omit"]);
  });
});

describe("storeRedirectCookie", () => {
  it("stores a cookie from a native redirect URL", async () => {
    const { store, map } = memoryCookieStore();
    const stored = await storeRedirectCookie(
      store,
      "aulora://auth/callback?cookie=session%3Dxyz%3B%20Path%3D%2F",
    );
    expect(stored).toBe(true);
    expect(map.get(AUTH_COOKIE_KEY)).toContain("session=xyz");
  });

  it("returns false when there is no cookie parameter", async () => {
    const { store } = memoryCookieStore();
    expect(await storeRedirectCookie(store, "aulora://auth/callback?state=1")).toBe(false);
    expect(await storeRedirectCookie(store, "not a url")).toBe(false);
  });
});
