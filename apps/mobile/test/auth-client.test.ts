import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuloraAuthClient } from "../src/lib/auth-client";
import { startProviderSignIn } from "../src/lib/auth-client";
import { PENDING_HANDOFF_KEY, readPendingAuthHandoff } from "../src/lib/auth-handoff";
import { authTokenKey, type CookieStore } from "../src/lib/cookie-fetch";

/**
 * The in-app browser branch is untrusted input too: a forged error page that
 * only names the workspace origin must not clear the pending transaction,
 * while the person closing the browser sheet explicitly may.
 */

const { openAuthSession } = vi.hoisted(() => ({ openAuthSession: vi.fn() }));

vi.mock("expo-crypto", () => {
  let counter = 0;
  return {
    getRandomBytesAsync: async (length: number) => {
      counter += 1;
      return new Uint8Array(length).fill(counter);
    },
    digestStringAsync: async () => "a".repeat(64),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { HEX: "hex" },
  };
});

vi.mock("expo-linking", () => ({
  createURL: (path: string) => `aulora://${path}`,
  openURL: async () => true,
  getInitialURL: async () => null,
}));

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => openAuthSession(...args),
}));

const SERVER = "https://chat.acme.com";

function memoryStore(): { store: CookieStore; map: Map<string, string> } {
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

function fakeClient(): AuloraAuthClient {
  return { getSession: vi.fn(async () => ({ data: {} })) } as unknown as AuloraAuthClient;
}

/** Builds the callback URL a workspace sends for the pending transaction. */
async function callbackUrl(store: CookieStore, params: Record<string, string>): Promise<string> {
  const pending = await readPendingAuthHandoff(store);
  expect(pending).not.toBeNull();
  const url = new URL("aulora://auth/callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("server", SERVER);
  url.searchParams.set("tx", pending?.tx ?? "");
  return url.toString();
}

describe("startProviderSignIn in-app callback", () => {
  beforeEach(() => {
    openAuthSession.mockReset();
    vi.unstubAllGlobals();
  });

  it("clears the pending transaction when the person cancels the browser sheet", async () => {
    const { store, map } = memoryStore();
    openAuthSession.mockResolvedValueOnce({ type: "cancel" });

    const result = await startProviderSignIn(
      fakeClient(),
      store,
      SERVER,
      "google",
      "oauth",
      "in-app",
    );

    expect(result).toEqual({ status: "cancel" });
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
  });

  it("does not clear the pending transaction for a forged error link", async () => {
    const { store, map } = memoryStore();
    openAuthSession.mockResolvedValueOnce({
      type: "success",
      url: `aulora://auth/callback?error=auth_cancelled&server=${encodeURIComponent(
        SERVER,
      )}&tx=${"z".repeat(64)}`,
    });

    const result = await startProviderSignIn(
      fakeClient(),
      store,
      SERVER,
      "google",
      "oauth",
      "in-app",
    );

    expect(result.status).toBe("error");
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
    expect(map.get(authTokenKey(SERVER))).toBeUndefined();
  });

  it("does not clear the pending transaction for an error with no transaction id", async () => {
    const { store, map } = memoryStore();
    openAuthSession.mockResolvedValueOnce({
      type: "success",
      url: `aulora://auth/callback?error=auth_cancelled&server=${encodeURIComponent(SERVER)}`,
    });

    const result = await startProviderSignIn(
      fakeClient(),
      store,
      SERVER,
      "google",
      "oauth",
      "in-app",
    );

    expect(result.status).toBe("error");
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("shows a matching error and ends the transaction", async () => {
    const { store, map } = memoryStore();
    openAuthSession.mockImplementationOnce(async () => ({
      type: "success",
      url: await callbackUrl(store, { error: "auth_cancelled" }),
    }));

    const result = await startProviderSignIn(
      fakeClient(),
      store,
      SERVER,
      "google",
      "oauth",
      "in-app",
    );

    expect(result).toEqual({ status: "error", message: "Sign-in was cancelled. Try again." });
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
  });

  it("exchanges a matching code and stores its token", async () => {
    const { store, map } = memoryStore();
    openAuthSession.mockImplementationOnce(async () => ({
      type: "success",
      url: await callbackUrl(store, { code: "abc" }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ token: "token-1" }), { status: 200 })),
    );

    const result = await startProviderSignIn(
      fakeClient(),
      store,
      SERVER,
      "google",
      "oauth",
      "in-app",
    );

    expect(result).toEqual({ status: "success" });
    expect(map.get(authTokenKey(SERVER))).toBe("token-1");
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
  });

  it("ignores a code for another workspace and keeps waiting", async () => {
    const { store, map } = memoryStore();
    openAuthSession.mockImplementationOnce(async () => {
      const pending = await readPendingAuthHandoff(store);
      const url = new URL("aulora://auth/callback");
      url.searchParams.set("code", "abc");
      url.searchParams.set("server", "https://other.example.com");
      url.searchParams.set("tx", pending?.tx ?? "");
      return { type: "success", url: url.toString() };
    });

    const result = await startProviderSignIn(
      fakeClient(),
      store,
      SERVER,
      "google",
      "oauth",
      "in-app",
    );

    expect(result.status).toBe("error");
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
    expect(map.get(authTokenKey(SERVER))).toBeUndefined();
  });
});
