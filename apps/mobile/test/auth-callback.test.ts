import { describe, expect, it } from "vitest";
import { completeAuthCallback } from "../src/lib/auth-callback";
import {
  beginAuthHandoff,
  exchangeAuthCode,
  PENDING_HANDOFF_KEY,
  takeStoredAuthHandoffError,
} from "../src/lib/auth-handoff";
import { authTokenKey, type CookieStore } from "../src/lib/cookie-fetch";

const SERVER = "https://chat.acme.com";
const TX = "tx-abcdefghijklmnopqrstuvwxyz0123456789";
const OTHER_TX = "tx-zyxwvutsrqponmlkjihgfedcba9876543210";

function errorUrl(message: string, server?: string, tx?: string): string {
  const params = new URLSearchParams({ error: message });
  if (server !== undefined) {
    params.set("server", server);
  }
  if (tx !== undefined) {
    params.set("tx", tx);
  }
  return `aulora://auth/callback?${params.toString()}`;
}

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

describe("completeAuthCallback", () => {
  it("exchanges a handoff code with the pending verifier", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: SERVER,
      tx: TX,
      initialUrl: async () => null,
      exchange: async (server, code, verifier) => {
        expect(server).toBe(SERVER);
        expect(code).toBe("abc");
        expect(verifier).toBe("verifier-1");
        return "token-1";
      },
    });

    expect(stored).toBe(true);
    expect(map.get(authTokenKey(SERVER))).toBe("token-1");
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
  });

  it("never accepts a session cookie from a deep link", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    const stored = await completeAuthCallback(store, {
      initialUrl: async () => "aulora://auth/callback?cookie=better-auth.session_token%3Dattacker",
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.size).toBe(1);
  });

  it("reads a handoff code from the launch URL", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-2", TX);
    const stored = await completeAuthCallback(store, {
      initialUrl: async () =>
        `aulora://auth/callback?code=fromurl&server=${encodeURIComponent(SERVER)}&tx=${TX}`,
      exchange: async (_server, _code, verifier) => {
        expect(verifier).toBe("verifier-2");
        return "token-2";
      },
    });

    expect(stored).toBe(true);
    expect(map.get(authTokenKey(SERVER))).toBe("token-2");
  });

  it("rejects a callback when no sign-in is pending", async () => {
    const { store, map } = memoryStore();
    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: SERVER,
      tx: TX,
      initialUrl: async () => null,
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.size).toBe(0);
  });

  it("rejects a callback for a different workspace", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: "https://other.example.com",
      tx: TX,
      initialUrl: async () => null,
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("rejects an expired pending transaction", async () => {
    const { store } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX, 0);
    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: SERVER,
      tx: TX,
      initialUrl: async () => null,
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
  });

  it("resolves when the launch URL cannot be read", async () => {
    const { store } = memoryStore();
    await expect(
      completeAuthCallback(store, {
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
      completeAuthCallback(store, {
        code: "abc",
        server: SERVER,
        tx: TX,
        initialUrl: async () => null,
      }),
    ).resolves.toBe(false);
  });

  it("ignores an error redirect when no sign-in is pending", async () => {
    const { store, map } = memoryStore();

    const stored = await completeAuthCallback(store, {
      initialUrl: async () => errorUrl("auth_cancelled", SERVER, TX),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.size).toBe(0);
  });

  it("shows a late expired error when no sign-in is pending but the workspace matches", async () => {
    const { store, map } = memoryStore();

    const stored = await completeAuthCallback(store, {
      currentServer: SERVER,
      initialUrl: async () => errorUrl("auth_expired", SERVER, TX),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBe(
      "Sign-in took too long, please try again.",
    );
    expect(map.size).toBe(0);
  });

  it("ignores a late error that is not expired or names another workspace", async () => {
    const { store } = memoryStore();

    expect(
      await completeAuthCallback(store, {
        currentServer: "https://other.example.com",
        initialUrl: async () => errorUrl("auth_expired", SERVER, TX),
        exchange: async () => "should-not-run",
      }),
    ).toBe(false);
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBeNull();

    expect(
      await completeAuthCallback(store, {
        currentServer: SERVER,
        initialUrl: async () => errorUrl("auth_cancelled", SERVER, TX),
        exchange: async () => "should-not-run",
      }),
    ).toBe(false);
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBeNull();
  });

  it("ignores an error redirect for another workspace without clearing the pending sign-in", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      initialUrl: async () => errorUrl("auth_cancelled", "https://other.example.com", TX),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("ignores an error redirect that names no workspace", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      initialUrl: async () => errorUrl("auth_cancelled", undefined, TX),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("clears the pending transaction for an error that matches the workspace", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      initialUrl: async () => errorUrl("auth_cancelled", SERVER, TX),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBe(
      "Sign-in was cancelled. Try again.",
    );
  });

  it("applies an error passed as a route param and explains an expired transaction", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      error: "auth_expired",
      server: SERVER,
      tx: TX,
      initialUrl: async () => null,
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBe(
      "Sign-in took too long, please try again.",
    );
  });

  it("ignores an error route param for another transaction without clearing the sign-in", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      error: "auth_cancelled",
      server: SERVER,
      tx: OTHER_TX,
      initialUrl: async () => null,
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBeNull();
  });

  it("ignores an error redirect with the wrong transaction id", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      initialUrl: async () => errorUrl("auth_cancelled", SERVER, OTHER_TX),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("ignores an error redirect with no transaction id", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      initialUrl: async () => errorUrl("auth_cancelled", SERVER),
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("ignores a code callback with the wrong transaction id", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    let exchanged = false;

    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: SERVER,
      tx: OTHER_TX,
      initialUrl: async () => null,
      exchange: async () => {
        exchanged = true;
        return "should-not-run";
      },
    });

    expect(stored).toBe(false);
    expect(exchanged).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
    expect(map.get(authTokenKey(SERVER))).toBeUndefined();
  });

  it("ignores a code callback with no transaction id", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);

    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: SERVER,
      initialUrl: async () => null,
      exchange: async () => "should-not-run",
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeDefined();
  });

  it("times out a never-answering exchange, clears the transaction, and reports it", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    const neverFetch = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;

    const stored = await completeAuthCallback(store, {
      code: "abc",
      server: SERVER,
      tx: TX,
      initialUrl: async () => null,
      exchange: (server, code, verifier) =>
        exchangeAuthCode(server, code, verifier, neverFetch, 10),
    });

    expect(stored).toBe(false);
    expect(map.get(PENDING_HANDOFF_KEY)).toBeUndefined();
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBe(
      "Sign-in timed out, please try again",
    );
  });

  it("runs a duplicate invocation once and stores no spurious failure", async () => {
    const { store, map } = memoryStore();
    await beginAuthHandoff(store, SERVER, "verifier-1", TX);
    let calls = 0;
    const exchange = async () => {
      calls += 1;
      await Promise.resolve();
      return calls === 1 ? "token-1" : null;
    };
    const input = {
      code: "abc",
      server: SERVER,
      tx: TX,
      initialUrl: async () => null,
      exchange,
    };

    // The callback route can run its effect twice while params arrive late.
    const [first, second] = await Promise.all([
      completeAuthCallback(store, input),
      completeAuthCallback(store, input),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(calls).toBe(1);
    expect(map.get(authTokenKey(SERVER))).toBe("token-1");
    expect(await takeStoredAuthHandoffError(store, SERVER)).toBeNull();
  });
});
