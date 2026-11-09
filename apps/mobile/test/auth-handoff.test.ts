import { describe, expect, it, vi } from "vitest";
import {
  AuthExchangeTimeoutError,
  authStartUrl,
  beginAuthHandoff,
  clearPendingAuthHandoff,
  clearStoredAuthHandoffError,
  completeAuthRedirect,
  exchangeAuthCode,
  PENDING_HANDOFF_KEY,
  PENDING_HANDOFF_TTL_MS,
  providerSignInErrorMessage,
  readAuthRedirectParams,
  readPendingAuthHandoff,
  STORED_HANDOFF_ERROR_TTL_MS,
  storeAuthHandoffError,
  storeAuthToken,
  storeExpiredWithoutPending,
  takeStoredAuthHandoffError,
} from "../src/lib/auth-handoff";
import { authTokenKey, type CookieStore } from "../src/lib/cookie-fetch";

const SERVER = "https://chat.acme.com";
const TX = "tx-abcdefghijklmnopqrstuvwxyz0123456789";
const OTHER_TX = "tx-zyxwvutsrqponmlkjihgfedcba9876543210";

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

describe("authStartUrl", () => {
  it("starts on the workspace origin with provider, kind, return and challenge", () => {
    const challenge = "a".repeat(64);
    const url = new URL(
      authStartUrl(SERVER, "google", "oauth", "aulora://auth/callback", challenge, TX),
    );
    expect(url.origin).toBe(SERVER);
    expect(url.pathname).toBe("/api/auth/native/start");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("kind")).toBe("oauth");
    expect(url.searchParams.get("return")).toBe("aulora://auth/callback");
    expect(url.searchParams.get("challenge")).toBe(challenge);
    expect(url.searchParams.get("tx")).toBe(TX);
  });
});

describe("readAuthRedirectParams", () => {
  it("reads a handoff code and workspace", () => {
    expect(
      readAuthRedirectParams(
        `aulora://auth/callback?code=abc&server=${encodeURIComponent(SERVER)}&tx=${TX}`,
      ),
    ).toEqual({
      code: "abc",
      server: SERVER,
      error: undefined,
      tx: TX,
    });
  });

  it("never exposes a legacy cookie parameter", () => {
    expect(
      readAuthRedirectParams("aulora://auth/callback?cookie=better-auth.session_token%3Dabc"),
    ).toEqual({ code: undefined, server: undefined, error: undefined });
  });

  it("reads an error and tolerates a malformed URL", () => {
    expect(readAuthRedirectParams("aulora://auth/callback?error=auth_cancelled")?.error).toBe(
      "auth_cancelled",
    );
    expect(readAuthRedirectParams("not a url")).toBeNull();
  });
});

describe("providerSignInErrorMessage", () => {
  it("maps the allowlisted finish errors to plain language", () => {
    expect(providerSignInErrorMessage("auth_expired")).toBe(
      "Sign-in took too long, please try again.",
    );
    expect(providerSignInErrorMessage("auth_cancelled")).toBe("Sign-in was cancelled. Try again.");
    expect(providerSignInErrorMessage("state_mismatch")).toMatch(/expired before it finished/);
    expect(providerSignInErrorMessage("invalid_provider")).toMatch(/not available/);
    expect(providerSignInErrorMessage("auth_failed")).toBe(
      "Sign-in could not be completed. Try again.",
    );
  });
});

describe("exchangeAuthCode", () => {
  it("posts the code and verifier and returns the token", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ token: "token-1", server: SERVER }))),
    ) as unknown as typeof fetch;

    expect(await exchangeAuthCode(SERVER, "abc", "verifier", fetchImpl)).toBe("token-1");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${SERVER}/api/auth/native/exchange`);
    expect(JSON.parse(String(init.body))).toEqual({ code: "abc", verifier: "verifier" });
  });

  it("returns null for a rejected or malformed answer", async () => {
    expect(
      await exchangeAuthCode(
        SERVER,
        "bad",
        "verifier",
        vi.fn(async () =>
          Promise.resolve(new Response("{}", { status: 400 })),
        ) as unknown as typeof fetch,
      ),
    ).toBeNull();
    expect(
      await exchangeAuthCode(
        SERVER,
        "bad",
        "verifier",
        vi.fn(async () => Promise.resolve(new Response("null"))) as unknown as typeof fetch,
      ),
    ).toBeNull();
  });

  it("times out instead of hanging when the workspace never answers", async () => {
    const neverFetch = vi.fn(() => new Promise<Response>(() => undefined));

    await expect(
      exchangeAuthCode(SERVER, "abc", "verifier", neverFetch as unknown as typeof fetch, 10),
    ).rejects.toBeInstanceOf(AuthExchangeTimeoutError);
  });

  it("times out when headers arrive but the body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const stalled = {
        ok: true,
        json: () => new Promise<unknown>(() => undefined),
      } as unknown as Response;
      const fetchImpl = vi.fn(async () => stalled) as unknown as typeof fetch;

      const pending = exchangeAuthCode(SERVER, "abc", "verifier", fetchImpl, 25);
      const assertion = expect(pending).rejects.toBeInstanceOf(AuthExchangeTimeoutError);
      await vi.advanceTimersByTimeAsync(26);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pending handoff", () => {
  it("uses the same ten-minute lifetime as the server transaction", () => {
    expect(PENDING_HANDOFF_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("stores the verifier and transaction id for the workspace origin", async () => {
    const { store } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    const pending = await readPendingAuthHandoff(store);
    expect(pending).toMatchObject({ verifier: "verifier-1", server: SERVER, tx: TX });
    await clearPendingAuthHandoff(store);
    expect(await readPendingAuthHandoff(store)).toBeNull();
  });

  it("refuses to start without a valid transaction id", async () => {
    const { store, map } = memoryStore();
    await expect(beginAuthHandoff(store, SERVER, "verifier-1", "too-short")).rejects.toThrow();
    expect(map.size).toBe(0);
  });

  it("drops a pending transaction after its TTL", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX, 0);
    expect(await readPendingAuthHandoff(store, PENDING_HANDOFF_TTL_MS + 1)).toBeNull();
    expect(map.size).toBe(0);
  });

  it("drops a malformed pending row", async () => {
    const { store } = memoryStore();
    await store.setItem(PENDING_HANDOFF_KEY, "not json");
    expect(await readPendingAuthHandoff(store)).toBeNull();
  });
});

describe("completeAuthRedirect", () => {
  function successfulExchange(token = "token-1") {
    return async (server: string, code: string, verifier: string) => {
      expect(server).toBe(SERVER);
      expect(verifier).toBe("verifier-1");
      return code === "abc" ? token : null;
    };
  }

  it("finishes a callback that echoes the pending transaction id", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const result = await completeAuthRedirect(
      store,
      { code: "abc", server: SERVER, tx: TX },
      successfulExchange(),
    );

    expect(result).toEqual({ status: "success" });
    expect(map.get(authTokenKey(SERVER))).toBe("token-1");
    expect(await readPendingAuthHandoff(store)).toBeNull();
  });

  it("ends the transaction on a matching error redirect", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const result = await completeAuthRedirect(
      store,
      { error: "auth_cancelled", server: SERVER, tx: TX },
      successfulExchange(),
    );

    expect(result).toEqual({ status: "error", error: "auth_cancelled" });
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
    expect(map.get(authTokenKey(SERVER))).toBeUndefined();
  });

  it("ignores a callback with the wrong transaction id without cancelling the sign-in", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    const exchange = vi.fn(successfulExchange());

    const result = await completeAuthRedirect(
      store,
      { code: "abc", server: SERVER, tx: OTHER_TX },
      exchange,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(exchange).not.toHaveBeenCalled();
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
    expect(map.get(authTokenKey(SERVER))).toBeUndefined();
  });

  it("ignores a callback with no transaction id", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const result = await completeAuthRedirect(
      store,
      { code: "abc", server: SERVER },
      successfulExchange(),
    );

    expect(result).toEqual({ status: "ignored" });
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("ignores a callback for another workspace", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const result = await completeAuthRedirect(
      store,
      { code: "abc", server: "https://other.example.com", tx: TX },
      successfulExchange(),
    );

    expect(result).toEqual({ status: "ignored" });
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("ignores a callback when no sign-in is pending", async () => {
    const { store, map } = memoryStore();

    const result = await completeAuthRedirect(
      store,
      { code: "abc", server: SERVER, tx: TX },
      successfulExchange(),
    );

    expect(result).toEqual({ status: "ignored" });
    expect(map.size).toBe(0);
  });

  it("ignores a forged error naming the origin but not the transaction", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const result = await completeAuthRedirect(
      store,
      { error: "auth_cancelled", server: SERVER, tx: OTHER_TX },
      successfulExchange(),
    );

    expect(result).toEqual({ status: "ignored" });
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
    expect(await readPendingAuthHandoff(store)).not.toBeNull();
  });
});

describe("storeExpiredWithoutPending", () => {
  it("stores the explicit expired message only for the current workspace", async () => {
    const { store, map } = memoryStore();

    expect(
      await storeExpiredWithoutPending(
        store,
        { error: "auth_expired", server: SERVER, tx: TX },
        SERVER,
      ),
    ).toBe(true);
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBe(
      "Sign-in took too long, please try again.",
    );
    expect(map.has(PENDING_HANDOFF_KEY)).toBe(false);
  });

  it("ignores other errors, another workspace, a malformed tx or a pending flow", async () => {
    const { store } = memoryStore();

    expect(
      await storeExpiredWithoutPending(
        store,
        { error: "auth_cancelled", server: SERVER, tx: TX },
        SERVER,
      ),
    ).toBe(false);
    expect(
      await storeExpiredWithoutPending(
        store,
        { error: "auth_expired", server: SERVER, tx: TX },
        "https://other.example.com",
      ),
    ).toBe(false);
    expect(
      await storeExpiredWithoutPending(
        store,
        { error: "auth_expired", server: SERVER, tx: "short" },
        SERVER,
      ),
    ).toBe(false);

    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    expect(
      await storeExpiredWithoutPending(
        store,
        { error: "auth_expired", server: SERVER, tx: OTHER_TX },
        SERVER,
      ),
    ).toBe(false);
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBeNull();
    expect(await readPendingAuthHandoff(store)).not.toBeNull();
  });
});

describe("storeAuthToken", () => {
  it("keys the token by workspace", async () => {
    const { store, map } = memoryStore();
    expect(await storeAuthToken(store, SERVER, "token-1")).toBe(true);
    expect(map.get(authTokenKey(SERVER))).toBe("token-1");
    expect(map.get(authTokenKey("https://other.example.com"))).toBeUndefined();
  });
});

describe("stored handoff errors", () => {
  it("only shows a stored error for the workspace that produced it", async () => {
    const { store } = memoryStore();
    await storeAuthHandoffError(store, "Sign-in took too long, please try again.", SERVER);

    // Another profile must not see it; switching back still can.
    expect(await takeStoredAuthHandoffError(store, "https://other.example.com")).toBeNull();
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBe(
      "Sign-in took too long, please try again.",
    );
  });

  it("discards a record older than five minutes", async () => {
    const { store } = memoryStore();
    await storeAuthHandoffError(store, "Sign-in took too long, please try again.", SERVER);

    expect(
      await takeStoredAuthHandoffError(store, SERVER, Date.now() + STORED_HANDOFF_ERROR_TTL_MS + 1),
    ).toBeNull();
  });

  it("clears a stored error after a successful sign-in", async () => {
    const { store } = memoryStore();
    await storeAuthHandoffError(store, "Sign-in could not be completed.", SERVER);
    await clearStoredAuthHandoffError(store);
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBeNull();
  });
});
