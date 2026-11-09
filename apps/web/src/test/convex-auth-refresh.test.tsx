import type { ServerProfile } from "@aulora/core";
import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { act, render, screen } from "@testing-library/react";
import { useConvexAuth } from "convex/react";
import { getFunctionName } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "../components/SessionGate";
import { createAuloraAuthClient } from "../lib/auth-client";
import { type ConnectionRecovery, createConnectionRecovery } from "../lib/connection-recovery";
import { createProviderAuth } from "../lib/provider-auth";
import { STUCK_TIMEOUT_MS } from "../lib/use-stuck-timeout";

/**
 * The Convex JWT lives 15 minutes and the client refreshes it just before it
 * expires (the plugin's default in `packages/convex/convex/auth.ts`). A refresh
 * is a routine, expected event: it must never unmount the signed-in tree.
 *
 * These mount the real Better Auth client and the real
 * `ConvexProviderWithAuth`, with a fake Convex client that follows the real
 * `AuthenticationManager` contract (fetch a token, then report whether the
 * server confirmed it). A refresh that cannot reach the auth endpoint keeps the
 * last token and the shell; only a token the server actually rejects may fall
 * back to the recovery rebuild.
 */

const PROFILE: ServerProfile = {
  id: "http://localhost:3000",
  baseUrl: "http://localhost:3000",
  name: "Acme",
  iconSeed: "acme",
  version: "1.4.0",
  apiVersion: 1,
  convexUrl: "http://localhost:3000",
  siteUrl: "http://localhost:3000",
  auth: { local: { enabled: true, signup: true }, providers: [] },
  addedAt: 0,
};

const harness = vi.hoisted(() => ({
  requests: [] as string[],
  mounts: 0,
  authStates: [] as string[],
}));

let authClient: ReturnType<typeof createAuloraAuthClient>;
/** Simulates the auth endpoint being unreachable during a refresh. */
let tokenEndpointDown = false;
/** Lifetime of the JWTs the fake auth endpoint mints, in seconds. */
let tokenTtlSeconds = 15 * 60;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** An unsigned JWT-shaped token, like Better Auth's Convex token. */
function jwt(secondsLeft: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({
    // Better Auth sets the subject to the signed-in user id; the token cache
    // checks it when a boot fetch is adopted after session discovery.
    sub: "u1",
    exp: Math.floor(Date.now() / 1_000) + secondsLeft,
  })}.signature`;
}

function installFetch(): void {
  tokenEndpointDown = false;
  tokenTtlSeconds = 15 * 60;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    harness.requests.push(url);
    if (url.includes("/get-session")) {
      return Promise.resolve(
        jsonResponse({
          session: {
            id: "session-a",
            token: "session-token",
            userId: "u1",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
          },
          user: { id: "u1", name: "Ada", email: "ada@example.com", emailVerified: true },
        }),
      );
    }
    if (url.includes("/convex/token")) {
      if (tokenEndpointDown) {
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      return Promise.resolve(jsonResponse({ token: jwt(tokenTtlSeconds) }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

/**
 * Mirrors the real `AuthenticationManager`: proactive refreshes are silent, a
 * token it cannot fetch at all reports the client unauthenticated, and a token
 * the server rejects eventually does too.
 */
class FakeConvexClient {
  fetchToken: ((args: { forceRefreshToken?: boolean }) => Promise<string | null>) | undefined =
    undefined;
  onChange: ((value: boolean) => void) | undefined = undefined;
  onRefreshChange: ((value: boolean) => void) | undefined = undefined;
  connectionCount = 0;

  setAuth(
    fetchToken: (args: { forceRefreshToken?: boolean }) => Promise<string | null>,
    onChange: (value: boolean) => void,
    onRefreshChange?: (value: boolean) => void,
  ): void {
    this.connectionCount += 1;
    this.fetchToken = fetchToken;
    this.onChange = onChange;
    this.onRefreshChange = onRefreshChange;
    void fetchToken({ forceRefreshToken: false }).then((token) => {
      if (token !== null) onChange(true);
    });
  }

  clearAuth(): void {}

  subscribeToConnectionState(): () => void {
    return () => undefined;
  }

  /** The manager's scheduled pre-expiry refetch, as `refetchToken()` runs it. */
  async scheduledRefresh(): Promise<void> {
    const token = await this.fetchToken?.({ forceRefreshToken: true });
    if (token !== null) {
      // The server confirms a fresh token; `hadAuth` means no auth-state change.
      return;
    }
    // `refetchToken()` could not fetch a token: clear auth and report it.
    this.onChange?.(false);
  }

  /** A fresh token the server keeps rejecting until the manager gives up. */
  async rejectedByServer(): Promise<void> {
    this.onRefreshChange?.(true);
    await this.fetchToken?.({ forceRefreshToken: true });
    this.onChange?.(false);
    this.onRefreshChange?.(false);
  }
}

function AuthStateProbe() {
  const auth = useConvexAuth();
  harness.authStates.push(
    `${String(auth.isAuthenticated)}/${String(auth.isLoading)}/${String(auth.isRefreshing)}`,
  );
  return null;
}

function ShellProbe() {
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      harness.mounts += 1;
    }
  }, []);
  return <div>Signed in</div>;
}

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return {
    ...actual,
    useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference);
      if (name.includes("publicConfig")) {
        return { features: {}, version: "1.4.0", setupRequired: false };
      }
      if (name.includes("members")) {
        return { member: { userId: "u1" }, isOwner: false };
      }
      return undefined;
    },
    useAction: () => vi.fn(),
    useMutation: () => vi.fn(),
  };
});

vi.mock("../components/chat/ChatSessionShell", () => ({
  ChatSessionShell: () => <ShellProbe />,
}));

vi.mock("../lib/use-server-recovery", () => ({
  useServerRecovery: (_profile: unknown, onRetry: () => void) => ({
    recovery: {
      serverName: "Acme",
      canRemoveServer: false,
      onRetry,
      onSwitchServer: () => undefined,
    },
    switchServer: () => undefined,
  }),
}));

function renderSession() {
  const convex = new FakeConvexClient();
  const providerClient = createProviderAuth(authClient).client;
  const recovery = { stuck: 0, healthy: 0, retry: 0 };
  let reset: () => void = () => undefined;
  const base = createConnectionRecovery({ reset: () => reset() });
  const connection: ConnectionRecovery = {
    stuck: () => {
      recovery.stuck += 1;
      base.stuck();
    },
    healthy: () => {
      recovery.healthy += 1;
      base.healthy();
    },
    retry: () => {
      recovery.retry += 1;
      base.retry();
    },
    attempts: () => base.attempts(),
    dispose: () => base.dispose(),
  };

  function Harness() {
    const [generation, setGeneration] = useState(0);
    reset = () => {
      setGeneration((current) => current + 1);
    };
    return (
      <ConvexBetterAuthProvider
        key={generation}
        client={convex as never}
        // The fix wraps the auth client so a failed token fetch keeps the last
        // token instead of reporting the session gone.
        // Handing the raw `authClient` here reproduces the bug: a failed
        // refresh answers `null`, Convex reports the session gone, and the gate
        // rebuilds the client pair (full remount) about 11 s later.
        authClient={providerClient as unknown as AuthClient}
      >
        <AuthStateProbe />
        <SessionGate
          profile={PROFILE}
          authClient={authClient}
          client={convex as never}
          connection={connection}
        />
      </ConvexBetterAuthProvider>
    );
  }

  render(<Harness />);
  return { convex, recovery };
}

beforeEach(() => {
  installFetch();
  harness.requests.length = 0;
  harness.authStates.length = 0;
  harness.mounts = 0;
  authClient = createAuloraAuthClient(PROFILE.siteUrl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Convex auth token refresh", () => {
  it("keeps the signed-in tree mounted when a scheduled refresh cannot reach the auth endpoint", async () => {
    vi.useFakeTimers();
    const session = renderSession();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(harness.mounts).toBe(1);

    tokenEndpointDown = true;
    await act(async () => {
      await session.convex.scheduledRefresh();
      await vi.advanceTimersByTimeAsync(10);
    });

    // The periodic refresh is not a logout: the last confirmed auth survives it.
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.queryByText("Checking your session…")).not.toBeInTheDocument();
    expect(session.recovery.stuck).toBe(0);

    // Past both the stuck timeout and the first rebuild delay: still no teardown.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUCK_TIMEOUT_MS + 5_000);
    });
    expect(session.recovery.stuck).toBe(0);
    expect(harness.mounts).toBe(1);
    expect(screen.getByText("Signed in")).toBeInTheDocument();
  });

  it("keeps the tree mounted across a successful periodic refresh", async () => {
    vi.useFakeTimers();
    const session = renderSession();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    await act(async () => {
      await session.convex.scheduledRefresh();
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(session.recovery.stuck).toBe(0);
    expect(harness.mounts).toBe(1);
    expect(screen.getByText("Signed in")).toBeInTheDocument();
  });

  it("rebuilds only after the server rejects a fresh token", async () => {
    vi.useFakeTimers();
    const session = renderSession();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    await act(async () => {
      await session.convex.rejectedByServer();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(session.recovery.stuck).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUCK_TIMEOUT_MS);
    });
    expect(session.recovery.stuck).toBe(1);
  });

  it("surfaces the failure once the cached token has expired during an outage", async () => {
    vi.useFakeTimers();
    // The token the fake endpoint minted expires before the outage begins, so
    // the fetcher must refuse to replay it and report the failure instead.
    tokenTtlSeconds = 1;
    const session = renderSession();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("Signed in")).toBeInTheDocument();

    tokenEndpointDown = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await session.convex.scheduledRefresh();
      await vi.advanceTimersByTimeAsync(10);
    });

    // Convex now reports the session gone (no token at all), which is the
    // genuine-rejection path: the gate must schedule the recovery rebuild.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUCK_TIMEOUT_MS + 5_000);
    });
    expect(session.recovery.stuck).toBeGreaterThan(0);
  });
});
