import {
  createProviderAuth,
  debugLog,
  recordDebugFailure,
  setProviderTokenIdentity,
} from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { createAccountScope } from "../lib/account-scope";
import type { AuloraAuthClient } from "../lib/auth-client";
import { authActionsFromClient } from "../lib/auth-client";

/**
 * The provider must receive a client whose `convex.token` never turns a
 * transient auth outage into a sign-out, while every other member of the Better
 * Auth client keeps working unchanged. The cache is bound to one session:
 * sign-out and an identity change drop it immediately, so an outage cannot
 * replay a token from the account that left.
 */

const TRANSIENT = { data: null, error: { status: 503 } };

/** Builds an unsigned JWT-shaped token whose payload names a user. */
function jwt(sub: string): string {
  const encode = (value: object) =>
    globalThis
      .btoa(JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode({ exp: 1_800_000_000, sub })}.signature`;
}

function fakeClient(token: (options?: unknown) => Promise<unknown>) {
  const session = vi.fn(() => ({ data: { session: { id: "s1" } }, isPending: false }));
  const signOut = vi.fn(
    async (): Promise<{ error: { message?: string } | null }> => ({
      error: null,
    }),
  );
  const client = {
    useSession: session,
    signOut,
    convex: { token },
  } as unknown as AuloraAuthClient;
  return { client, session, signOut, token };
}

describe("createProviderAuth", () => {
  it("keeps the last token when the token endpoint is unreachable", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } })
      .mockResolvedValue({ data: null, error: { status: 503 } });
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);

    await expect(provider.client.convex.token({ fetchOptions: { throw: false } })).resolves.toEqual(
      { data: { token: "jwt-1" } },
    );
    await expect(provider.client.convex.token({ fetchOptions: { throw: false } })).resolves.toEqual(
      { data: { token: "jwt-1" }, error: null },
    );
    expect(provider.lastToken()).toBe("jwt-1");
  });

  it("forwards every other member of the auth client unchanged", () => {
    const fake = fakeClient(vi.fn(async () => ({ data: { token: "jwt-1" } })));
    const provider = createProviderAuth(fake.client);

    expect(provider.client.useSession).toBe(fake.session);
    expect(provider.client.signOut).toBe(fake.signOut);
  });

  it("does not keep a token the server rejected", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } })
      .mockResolvedValue({ data: null, error: { status: 401 } });
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    await provider.client.convex.token();

    await expect(provider.client.convex.token()).resolves.toEqual({
      data: null,
      error: { status: 401 },
    });
    expect(provider.lastToken()).toBeNull();
  });

  it("clears the cached token synchronously on explicit sign-out", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(TRANSIENT);
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    provider.setIdentity("session-a:user-a");
    await provider.client.convex.token();

    debugLog.record("account-a", "private previous account error");
    await authActionsFromClient(fake.client).signOut();
    expect(debugLog.report("account-b", "")).not.toContain("private previous account error");

    expect(provider.lastToken()).toBeNull();
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    // The endpoint is still failing: whatever comes next, it is not A's token.
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });

  it("does not hand user A's token to user B when the endpoint fails", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(TRANSIENT);
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    provider.setIdentity("session-a:user-a");
    await provider.client.convex.token();

    await authActionsFromClient(fake.client).signOut();
    provider.setIdentity("session-b:user-b");

    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });

  it("discards a token that resolves after an explicit sign-out", async () => {
    let resolveToken!: (value: unknown) => void;
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue(TRANSIENT);
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    provider.setIdentity("session-a:user-a");

    const inFlight = provider.client.convex.token();
    await authActionsFromClient(fake.client).signOut();
    resolveToken({ data: { token: "jwt-a" } });

    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });

  it("does not replay user A's in-flight token after switching to user B", async () => {
    let resolveA!: (value: unknown) => void;
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValue(TRANSIENT);
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    provider.setIdentity("session-a:user-a");

    const inFlightA = provider.client.convex.token();
    setProviderTokenIdentity(fake.client, "session-b:user-b");

    // B's own request fails while A's is still in flight: the outage surfaces,
    // and A's late answer is neither cached nor returned as B's session.
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
    expect(provider.lastToken()).toBeNull();

    resolveA({ data: { token: "jwt-a" } });
    await expect(inFlightA).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });

  it("still serves concurrent requests under the same identity", async () => {
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
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
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    provider.setIdentity("session-a:user-a");

    const first = provider.client.convex.token();
    const second = provider.client.convex.token();

    resolveB({ data: { token: "jwt-b" } });
    await expect(second).resolves.toEqual({ data: { token: "jwt-b" } });
    resolveA({ data: { token: "jwt-a" } });
    await expect(first).resolves.toEqual({ data: { token: "jwt-a" } });
    expect(provider.lastToken()).toBe("jwt-a");
  });

  it("adopts the first boot token when its subject matches the session user", async () => {
    const token = jwt("user-a");
    let resolveToken!: (value: unknown) => void;
    const tokenFn = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue(TRANSIENT);
    const fake = fakeClient(tokenFn);
    const provider = createProviderAuth(fake.client);

    // The first fetch starts before `useSession` resolves the composite id.
    const inFlight = provider.client.convex.token();
    setProviderTokenIdentity(fake.client, "session-1:user-a");
    resolveToken({ data: { token } });

    await expect(inFlight).resolves.toEqual({ data: { token } });
    expect(provider.lastToken()).toBe(token);
  });

  it("does not adopt a boot token issued for another user", async () => {
    const tokenA = jwt("user-a");
    const tokenB = jwt("user-b");
    let resolveToken!: (value: unknown) => void;
    const tokenFn = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue({ data: { token: tokenB } });
    const fake = fakeClient(tokenFn);
    const provider = createProviderAuth(fake.client);

    // The request ran with A's session while discovery resolved B.
    const inFlight = provider.client.convex.token();
    setProviderTokenIdentity(fake.client, "session-b:user-b");
    resolveToken({ data: { token: tokenA } });

    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual({ data: { token: tokenB } });
    expect(provider.lastToken()).toBe(tokenB);
  });

  it("refetches instead of adopting a boot token without a readable subject", async () => {
    const tokenB = jwt("user-b");
    let resolveToken!: (value: unknown) => void;
    const tokenFn = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      )
      .mockResolvedValue({ data: { token: tokenB } });
    const fake = fakeClient(tokenFn);
    const provider = createProviderAuth(fake.client);

    const inFlight = provider.client.convex.token();
    setProviderTokenIdentity(fake.client, "session-b:user-b");
    resolveToken({ data: { token: "opaque-token" } });

    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual({ data: { token: tokenB } });
    expect(provider.lastToken()).toBe(tokenB);
  });

  it("records a handled sign-out failure and still recovers the token store", async () => {
    const token = vi.fn(async () => TRANSIENT);
    const fake = fakeClient(token);
    fake.signOut.mockResolvedValue({ error: { message: "Session already lost" } });
    debugLog.clear();

    await authActionsFromClient(fake.client).signOut();

    const entries = debugLog.snapshot();
    expect(entries.map((entry) => entry.source)).toContain("auth.signout");
    expect(entries.map((entry) => entry.detail).join(" ")).toContain("Session already lost");
  });

  it("records a thrown sign-out failure before rethrowing it", async () => {
    const fake = fakeClient(vi.fn(async () => TRANSIENT));
    fake.signOut.mockRejectedValue(new Error("Network unreachable"));
    debugLog.clear();

    await expect(authActionsFromClient(fake.client).signOut()).rejects.toThrow(
      "Network unreachable",
    );
    const entries = debugLog.snapshot();
    expect(entries.map((entry) => entry.source)).toContain("auth.signout");
  });

  it("drops the cache when the session identity changes without a sign-out", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(TRANSIENT);
    const fake = fakeClient(token);
    const provider = createProviderAuth(fake.client);
    provider.setIdentity("session-a:user-a");
    await provider.client.convex.token();

    provider.setIdentity("session-b:user-b");

    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });
});

it.each(["throw", "result", "success"])(
  "scopes deferred signout %s to the originating account",
  async (settles) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const request = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const client = { signOut: () => request } as unknown as AuloraAuthClient;
    const scope = createAccountScope(recordDebugFailure);
    const recover = vi.fn();
    const pending = authActionsFromClient(client, undefined, recover, scope).signOut();
    scope.close();
    debugLog.clear();
    debugLog.record("B", "current B");
    if (settles === "throw") reject(new Error("A-only signout sentinel"));
    else resolve({ error: settles === "success" ? null : { message: "A-only signout sentinel" } });
    await pending;
    expect(debugLog.report("B", "")).not.toContain("A-only signout sentinel");
    expect(debugLog.report("B", "")).toContain("current B");
    expect(recover).not.toHaveBeenCalled();
  },
);
