import { debugLog, recordDebugFailure } from "@aulora/core";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountScope } from "../src/lib/account-scope";
import type { AuloraAuthClient } from "../src/lib/auth-client";
import { startProviderSignIn } from "../src/lib/auth-client";
import { PENDING_HANDOFF_KEY, readPendingAuthHandoff } from "../src/lib/auth-handoff";
import { authTokenKey, type CookieStore } from "../src/lib/cookie-fetch";
import { deleteAccountAction, signOutAction } from "../src/lib/session-account-actions";

/**
 * The in-app browser branch is untrusted input too: a forged error page that
 * only names the workspace origin must not clear the pending transaction,
 * while the person closing the browser sheet explicitly may.
 */

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

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

describe("account debug log isolation", () => {
  for (const action of ["signOut", "deleteAccount"] as const) {
    it(`clears the previous account logs on ${action}`, async () => {
      const client = {
        signOut: vi.fn(async () => ({ error: null })),
        deleteUser: vi.fn(async () => ({ error: null })),
      } as unknown as AuloraAuthClient;
      debugLog.record("account-a", "previous private account error");
      await (action === "signOut" ? signOutAction(client) : deleteAccountAction(client))();
      expect(debugLog.report("account-b", "")).not.toContain("previous private account error");
    });
  }

  it("records a handled sign-out failure instead of leaving it silent", async () => {
    const client = {
      signOut: vi.fn(async () => ({ error: { message: "Session expired" } })),
    } as unknown as AuloraAuthClient;
    await signOutAction(client)();
    const entries = debugLog.snapshot();
    expect(entries.map((entry) => entry.source)).toContain("auth.signout");
    expect(entries.map((entry) => entry.detail).join(" ")).toContain("Session expired");
  });

  it("records a thrown sign-out failure instead of dropping it", async () => {
    const client = {
      signOut: vi.fn(async () => {
        throw new Error("Network unreachable");
      }),
    } as unknown as AuloraAuthClient;
    await signOutAction(client)();
    expect(debugLog.snapshot().map((entry) => entry.source)).toContain("auth.signout");
    expect(
      debugLog
        .snapshot()
        .map((entry) => entry.detail)
        .join(" "),
    ).toContain("Network unreachable");
  });

  it("records a handled account-deletion failure", async () => {
    const client = {
      deleteUser: vi.fn(async () => ({ error: { message: "Delete is disabled" } })),
    } as unknown as AuloraAuthClient;
    await deleteAccountAction(client)();
    expect(debugLog.snapshot().map((entry) => entry.source)).toContain("auth.deleteAccount");
    expect(
      debugLog
        .snapshot()
        .map((entry) => entry.detail)
        .join(" "),
    ).toContain("Delete is disabled");
  });
});

for (const action of ["signOut", "deleteAccount"] as const) {
  for (const settles of ["throw", "result", "success"] as const) {
    it(`drops late ${action} ${settles} diagnostics and alerts after switching accounts`, async () => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const request = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const client = {
        signOut: () => request,
        deleteUser: () => request,
      } as unknown as AuloraAuthClient;
      const scope = createAccountScope(recordDebugFailure);
      const pending = (
        action === "signOut" ? signOutAction(client, scope) : deleteAccountAction(client, scope)
      )();
      scope.close();
      debugLog.clear();
      debugLog.record("B", "current B");
      vi.mocked(Alert.alert).mockClear();
      if (settles === "throw") reject(new Error("A-only account sentinel"));
      else
        resolve({ error: settles === "success" ? null : { message: "A-only account sentinel" } });
      await pending;
      expect(debugLog.report("B", "")).not.toContain("A-only account sentinel");
      expect(debugLog.report("B", "")).toContain("current B");
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  }
}
