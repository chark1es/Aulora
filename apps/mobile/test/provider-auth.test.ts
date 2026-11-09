import { bytesToBase64Url, utf8Encode } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import type { AuloraAuthClient } from "../src/lib/auth-client";
import {
  createProviderAuth,
  resetProviderToken,
  setProviderTokenIdentity,
} from "../src/lib/provider-auth";

/**
 * Native counterpart of the web provider-auth tests. Sign-out on a phone is
 * handled by `resetProviderToken` (called from every sign-out and account
 * deletion path) and by the session identity effect in `SessionGate`; neither
 * may leave a previous account's Convex token behind for an outage to replay.
 */

const TRANSIENT = { data: null, error: { status: 503 } };

/** Builds an unsigned JWT-shaped token whose payload names a user. */
function jwt(sub: string): string {
  const encode = (value: object) => bytesToBase64Url(utf8Encode(JSON.stringify(value)));
  return `${encode({ alg: "none" })}.${encode({ exp: 1_800_000_000, sub })}.signature`;
}

function fakeClient(token: (options?: unknown) => Promise<unknown>) {
  return {
    useSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    convex: { token },
  } as unknown as AuloraAuthClient;
}

describe("mobile createProviderAuth", () => {
  it("keeps the last token when the token endpoint is unreachable", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-1" } })
      .mockResolvedValue(TRANSIENT);
    const provider = createProviderAuth(fakeClient(token));

    await provider.client.convex.token();
    await expect(provider.client.convex.token()).resolves.toEqual({
      data: { token: "jwt-1" },
      error: null,
    });
    expect(provider.lastToken()).toBe("jwt-1");
  });

  it("clears the cache synchronously when a sign-out path resets it", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(TRANSIENT);
    const client = fakeClient(token);
    const provider = createProviderAuth(client);
    provider.setIdentity("user-a");
    await provider.client.convex.token();

    resetProviderToken(client);

    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });

  it("does not hand user A's token to user B", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(TRANSIENT);
    const client = fakeClient(token);
    const provider = createProviderAuth(client);
    provider.setIdentity("user-a");
    await provider.client.convex.token();

    resetProviderToken(client);
    setProviderTokenIdentity(client, "user-b");

    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });

  it("discards a token that resolves after a sign-out reset", async () => {
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
    const client = fakeClient(token);
    const provider = createProviderAuth(client);
    provider.setIdentity("user-a");

    const inFlight = provider.client.convex.token();
    resetProviderToken(client);
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
    const client = fakeClient(token);
    const provider = createProviderAuth(client);
    provider.setIdentity("user-a");

    const inFlightA = provider.client.convex.token();
    setProviderTokenIdentity(client, "user-b");

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
    const client = fakeClient(token);
    const provider = createProviderAuth(client);
    provider.setIdentity("user-a");

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
    const client = fakeClient(tokenFn);
    const provider = createProviderAuth(client);

    const inFlight = provider.client.convex.token();
    setProviderTokenIdentity(client, "user-a");
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
    const client = fakeClient(tokenFn);
    const provider = createProviderAuth(client);

    const inFlight = provider.client.convex.token();
    setProviderTokenIdentity(client, "user-b");
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
    const client = fakeClient(tokenFn);
    const provider = createProviderAuth(client);

    const inFlight = provider.client.convex.token();
    setProviderTokenIdentity(client, "user-b");
    resolveToken({ data: { token: "opaque-token" } });

    await expect(inFlight).resolves.toEqual({ data: null, error: { status: 0 } });
    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual({ data: { token: tokenB } });
    expect(provider.lastToken()).toBe(tokenB);
  });

  it("drops the cache when the session identity changes", async () => {
    const token = vi
      .fn<(options?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ data: { token: "jwt-a" } })
      .mockResolvedValue(TRANSIENT);
    const client = fakeClient(token);
    const provider = createProviderAuth(client);
    provider.setIdentity("user-a");
    await provider.client.convex.token();

    setProviderTokenIdentity(client, "user-b");

    expect(provider.lastToken()).toBeNull();
    await expect(provider.client.convex.token()).resolves.toEqual(TRANSIENT);
  });
});
