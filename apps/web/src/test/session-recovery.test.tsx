import type { ServerProfile } from "@aulora/core";
import { debugLog } from "@aulora/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSession } from "../components/ProfileSession";
import { RECOVERY_DELAYS_MS } from "../lib/connection-recovery";
import { readSessionToken, writeSessionToken } from "../lib/session-token";
import { STUCK_TIMEOUT_MS } from "../lib/use-stuck-timeout";

/**
 * Reproduces the reported failure: after the server restarted, every retry
 * re-used the Convex client whose token the server no longer accepted and the
 * Better Auth store that still held the old snapshot, so the app stayed on
 * "Reconnecting" until it was quit and reopened. Recovery now replaces both
 * clients, so the same retry has to connect.
 */

const PROFILE: ServerProfile = {
  id: "https://chat.example.com",
  baseUrl: "https://chat.example.com",
  name: "Acme",
  iconSeed: "acme",
  version: "1.3.0",
  apiVersion: 1,
  convexUrl: "https://chat.example.com",
  siteUrl: "https://chat.example.com",
  auth: { local: { enabled: true, signup: true }, providers: [] },
  addedAt: 0,
};

const [FIRST_RECOVERY_DELAY_MS] = RECOVERY_DELAYS_MS;

const harness = vi.hoisted(() => ({
  server: {
    /** No answer at all: a server that is down or still restarting. */
    down: false,
    /** A failed background refetch while the stored session is still valid. */
    sessionError: false,
    /** A stored token the server now rejects with 401. */
    rejectsStoredToken: false,
    /** Whether Convex accepted the session it was given. */
    convexAuthenticated: true,
    /** True while Convex is fetching a replacement token. */
    convexRefreshing: false,
  },
  tokens: new Map<string, string>(),
  clients: [] as { readonly url: string; closed: boolean }[],
}));

vi.mock("convex/react", () => {
  class RecordingConvexClient {
    readonly record: { readonly url: string; closed: boolean };
    constructor(url: string) {
      this.record = { url, closed: false };
      harness.clients.push(this.record);
    }
    subscribeToConnectionState(): () => void {
      return () => undefined;
    }
    close(): Promise<void> {
      this.record.closed = true;
      return Promise.resolve();
    }
  }
  return {
    ConvexReactClient: RecordingConvexClient,
    useConvexAuth: () => ({
      isLoading: false,
      isAuthenticated: harness.server.convexAuthenticated,
      isRefreshing: harness.server.convexRefreshing,
    }),
    // One answer for every query. `features` marks a current server; without it
    // the session gate would treat this one as older than the app.
    useQuery: () => ({ member: { userId: "u1" }, isOwner: false, features: {} }),
  };
});

vi.mock("@convex-dev/better-auth/react", () => ({
  ConvexBetterAuthProvider: ({ children }: { readonly children: ReactNode }) => children,
}));

vi.mock("../lib/session-token", () => ({
  readSessionToken: (siteUrl: string) => harness.tokens.get(siteUrl) ?? null,
  writeSessionToken: (siteUrl: string, token: string) => {
    harness.tokens.set(siteUrl, token);
  },
  clearSessionToken: (siteUrl: string) => {
    harness.tokens.delete(siteUrl);
  },
  isCrossOrigin: () => true,
}));

vi.mock("../lib/auth-client", () => ({
  createAuloraAuthClient: () => ({
    useSession: () => {
      if (harness.server.down) {
        return {
          data: undefined,
          error: new TypeError("Failed to fetch"),
          isPending: false,
          refetch: () => Promise.resolve(),
        };
      }
      const stored = harness.tokens.get(PROFILE.siteUrl);
      if (stored !== undefined && harness.server.rejectsStoredToken) {
        return {
          data: undefined,
          error: { status: 401, statusText: "Unauthorized", message: "Invalid session" },
          isPending: false,
          refetch: () => Promise.resolve(),
        };
      }
      if (harness.server.sessionError) {
        return {
          data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
          error: new TypeError("Failed to fetch"),
          isPending: false,
          refetch: () => Promise.resolve(),
        };
      }
      return {
        data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
        error: null,
        isPending: false,
        refetch: () => Promise.resolve(),
      };
    },
  }),
  authActionsFromClient: () => ({
    signInEmail: () => Promise.resolve({ error: null }),
    signUpEmail: () => Promise.resolve({ error: null }),
    signInSocial: () => Promise.resolve({ error: null }),
    signInOAuth2: () => Promise.resolve({ error: null }),
    signOut: () => Promise.resolve({ error: null }),
  }),
}));

/**
 * The real hook needs a profile store and a router; only its retry wiring
 * matters here, and that is the session gate's own handler.
 */
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

vi.mock("../components/chat/ChatSessionShell", () => ({
  ChatSessionShell: () => <div>Signed in</div>,
}));

beforeEach(() => {
  harness.server.down = false;
  harness.server.sessionError = false;
  harness.server.rejectsStoredToken = false;
  harness.server.convexAuthenticated = true;
  harness.server.convexRefreshing = false;
  harness.tokens.clear();
  harness.clients.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProfileSession recovery", () => {
  it("connects after the server returns when the person retries, using fresh clients", () => {
    harness.server.down = true;
    writeSessionToken(PROFILE.siteUrl, "kept-through-an-outage");
    render(<ProfileSession profile={PROFILE} />);

    expect(screen.getByText("Can’t reach Acme")).toBeInTheDocument();
    expect(harness.clients).toHaveLength(1);

    harness.server.down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    // The dead client is replaced rather than retried: a second client exists
    // and the first one was closed.
    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[0]?.closed).toBe(true);
    // A transient outage is not a sign-out: the stored login survives.
    expect(readSessionToken(PROFILE.siteUrl)).toBe("kept-through-an-outage");
  });

  it("rebuilds on its own when Convex will not accept a signed-in session", () => {
    vi.useFakeTimers();
    harness.server.convexAuthenticated = false;
    render(<ProfileSession profile={PROFILE} />);

    // The shell renders from the Better Auth snapshot, but Convex refused the
    // token, which is the state that used to stick forever.
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(harness.clients).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(STUCK_TIMEOUT_MS);
    });
    expect(harness.clients).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(FIRST_RECOVERY_DELAY_MS);
    });
    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[0]?.closed).toBe(true);
  });

  it("drops a token the server rejects and signs in without it", () => {
    writeSessionToken(PROFILE.siteUrl, "stale-token");
    harness.server.rejectsStoredToken = true;
    debugLog.record("previous-account", "sentinel-old-account");
    render(<ProfileSession profile={PROFILE} />);

    expect(readSessionToken(PROFILE.siteUrl)).toBeNull();
    expect(debugLog.report("new-account", "")).not.toContain("sentinel-old-account");
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(harness.clients).toHaveLength(2);
  });

  it("keeps the stored token when the failure is only an outage", () => {
    writeSessionToken(PROFILE.siteUrl, "still-valid");
    harness.server.down = true;
    render(<ProfileSession profile={PROFILE} />);

    expect(readSessionToken(PROFILE.siteUrl)).toBe("still-valid");
  });

  it("does not rebuild the clients for a failed background session refresh", () => {
    vi.useFakeTimers();
    harness.server.sessionError = true;
    render(<ProfileSession profile={PROFILE} />);

    // The stored session still rendered the shell; the failed refetch is not a
    // reason to tear the app down.
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(STUCK_TIMEOUT_MS + FIRST_RECOVERY_DELAY_MS * 2);
    });
    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]?.closed).toBe(false);
  });

  it("waits for an explicit retry when the session lookup is unreachable", () => {
    vi.useFakeTimers();
    harness.server.down = true;
    writeSessionToken(PROFILE.siteUrl, "kept-through-an-outage");
    render(<ProfileSession profile={PROFILE} />);

    expect(screen.getByText("Can’t reach Acme")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(STUCK_TIMEOUT_MS + FIRST_RECOVERY_DELAY_MS * 2);
    });
    // A slow or failed lookup recovers in place; rebuilding belongs to a
    // session Convex actually rejected, not to a network wait.
    expect(harness.clients).toHaveLength(1);
  });

  it("does not rebuild while Convex is fetching a replacement token", () => {
    vi.useFakeTimers();
    harness.server.convexAuthenticated = false;
    harness.server.convexRefreshing = true;
    render(<ProfileSession profile={PROFILE} />);

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(STUCK_TIMEOUT_MS + FIRST_RECOVERY_DELAY_MS * 2);
    });
    expect(harness.clients).toHaveLength(1);
  });
});
