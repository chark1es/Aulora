import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_KEY, type CookieStore, createCookieFetch } from "../src/lib/cookie-fetch";

const ORIGIN = "https://chat.acme.com";

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

function createTestAuth() {
  const database: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "test-secret-that-is-at-least-32-characters",
    trustedOrigins: [ORIGIN],
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    // Better Auth skips the origin check when it detects a test environment.
    // Force it on so this exercises the same CSRF path as production.
    advanced: { disableCSRFCheck: false, disableOriginCheck: false },
  });
  return { auth, database };
}

describe("Better Auth origin handling", () => {
  it("invalidates the session on a native sign-out", async () => {
    const { auth, database } = createTestAuth();
    const { store, map } = memoryCookieStore();
    const cookieFetch = createCookieFetch({
      store,
      baseFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        auth.handler(new Request(input, init))) as typeof fetch,
    });

    const signUp = await cookieFetch(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "password123", name: "A" }),
    });
    expect(signUp.status).toBe(200);
    expect(map.get(AUTH_COOKIE_KEY)).toContain("session_token");

    const before = await cookieFetch(`${ORIGIN}/api/auth/get-session`);
    expect(await before.json()).toMatchObject({ user: { email: "a@example.com" } });
    expect(database.session).toHaveLength(1);

    const signOut = await cookieFetch(`${ORIGIN}/api/auth/sign-out`, { method: "POST" });
    expect(signOut.status).toBe(200);
    expect(database.session).toHaveLength(0);

    const after = await cookieFetch(`${ORIGIN}/api/auth/get-session`);
    expect(await after.json()).toBeNull();
  });

  it("rejects a cookie-bearing sign-out from an untrusted origin", async () => {
    const { auth } = createTestAuth();
    const { store, map } = memoryCookieStore();
    const cookieFetch = createCookieFetch({
      store,
      baseFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        auth.handler(new Request(input, init))) as typeof fetch,
    });

    await cookieFetch(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "b@example.com", password: "password123", name: "B" }),
    });
    const cookie = map.get(AUTH_COOKIE_KEY);
    expect(cookie).toBeDefined();

    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: { cookie: cookie ?? "", origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });

    const session = await cookieFetch(`${ORIGIN}/api/auth/get-session`);
    expect(await session.json()).toMatchObject({ user: { email: "b@example.com" } });
  });
});
