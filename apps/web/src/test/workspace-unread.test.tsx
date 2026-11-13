import type { ServerProfile } from "@aulora/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockWatch {
  readonly onUpdate: (callback: () => void) => () => void;
  readonly localQueryResult: () => { total: number } | undefined;
}

const state = vi.hoisted(() => ({
  tokens: new Map<string, string | null>(),
  configs: new Map<string, unknown>(),
  totals: new Map<string, number>(),
  jwts: new Map<string, Array<string | { reject: true }>>(),
  jwtCalls: new Map<string, number>(),
  clients: new Map<string, MockClient>(),
  authClients: new Map<string, MockAuthClient>(),
  watchCalls: [] as string[],
  watchUpdates: new Map<string, Set<() => void>>(),
  resultThrows: new Map<string, number>(),
  cleared: [] as string[],
}));

vi.mock("../lib/session-token", () => ({
  readSessionToken: (siteUrl: string) => state.tokens.get(siteUrl) ?? null,
  clearSessionToken: (siteUrl: string) => {
    state.cleared.push(siteUrl);
    state.tokens.delete(siteUrl);
  },
}));

/**
 * Keep the real provider wrapper (`createProviderAuth`) and replace only the
 * Better Auth client boundary. The fake's `convex.token` answers like
 * `/api/auth/convex/token`: it returns a short-lived JWT, not the session
 * bearer the hook read from storage.
 */
vi.mock("../lib/auth-client", () => ({
  createAuloraAuthClient: (siteUrl: string) => {
    const auth = {
      convex: {
        token: vi.fn(async () => {
          const calls = state.jwtCalls.get(siteUrl) ?? 0;
          state.jwtCalls.set(siteUrl, calls + 1);
          const answers = state.jwts.get(siteUrl) ?? ["jwt-default"];
          const answer = answers[Math.min(calls, answers.length - 1)];
          if (typeof answer === "object") {
            return { data: null, error: { status: 401 } };
          }
          return { data: { token: answer }, error: null };
        }),
      },
    };
    state.authClients.set(siteUrl, auth);
    return auth;
  },
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    readonly url: string;
    readonly close = vi.fn();
    readonly setAuth = vi.fn(
      (fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>) => {
        this.fetchToken = fetchToken;
      },
    );
    fetchToken?: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
    constructor(url: string) {
      this.url = url;
      state.clients.set(url, this as unknown as MockClient);
    }
    async query(): Promise<unknown> {
      return state.configs.get(this.url) ?? {};
    }
    watchQuery(): MockWatch {
      state.watchCalls.push(this.url);
      const updates = new Set<() => void>();
      state.watchUpdates.set(this.url, updates);
      return {
        onUpdate: (callback: () => void) => {
          updates.add(callback);
          return () => updates.delete(callback);
        },
        localQueryResult: () => {
          const throws = state.resultThrows.get(this.url) ?? 0;
          if (throws > 0) {
            state.resultThrows.set(this.url, throws - 1);
            throw new Error("socket changed while reading");
          }
          return { total: state.totals.get(this.url) ?? 0 };
        },
      };
    }
  },
}));

import {
  MAX_WORKSPACE_BADGE_SUBSCRIPTIONS,
  useWorkspaceUnreadCounts,
} from "../lib/use-workspace-unread";

interface MockAuthClient {
  readonly convex: {
    readonly token: ReturnType<typeof vi.fn>;
  };
}

interface MockClient {
  readonly url: string;
  readonly close: ReturnType<typeof vi.fn>;
  readonly setAuth: ReturnType<typeof vi.fn>;
  readonly fetchToken?: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
}

function profile(name: string): ServerProfile {
  return {
    id: `profile-${name}`,
    name,
    baseUrl: `https://${name}.example.com`,
    siteUrl: `https://${name}.example.com`,
    convexUrl: `https://convex.${name}.example.com`,
    iconSeed: `seed-${name}`,
    version: "1.0.0",
    apiVersion: 1,
    addedAt: 1,
    auth: { local: { enabled: true, signup: true }, providers: [] },
  } as unknown as ServerProfile;
}

beforeEach(() => {
  state.tokens = new Map();
  state.configs = new Map();
  state.totals = new Map();
  state.jwts = new Map();
  state.jwtCalls = new Map();
  state.clients = new Map();
  state.authClients = new Map();
  state.watchCalls = [];
  state.watchUpdates = new Map();
  state.resultThrows = new Map();
  state.cleared = [];
});

describe("useWorkspaceUnreadCounts", () => {
  it("exchanges the stored session bearer for that profile's Convex JWT", async () => {
    const acme = profile("acme");
    const globex = profile("globex");
    state.tokens.set(globex.siteUrl, "session-bearer-globex");
    state.jwts.set(globex.siteUrl, ["convex-jwt-globex"]);
    state.configs.set(globex.convexUrl, { capabilities: { workspaceUnread: true } });
    state.totals.set(globex.convexUrl, 7);

    const profiles = [acme, globex];
    const { result } = renderHook(() =>
      useWorkspaceUnreadCounts({
        profiles,
        activeProfileId: acme.id,
      }),
    );

    await waitFor(() => expect(state.watchCalls).toContain(globex.convexUrl));
    const client = state.clients.get(globex.convexUrl);
    await expect(client?.fetchToken?.({ forceRefreshToken: false })).resolves.toBe(
      "convex-jwt-globex",
    );
    expect(state.authClients.get(globex.siteUrl)?.convex.token).toHaveBeenCalled();
    // The opaque session bearer is never handed to Convex as an access token.
    expect(await client?.fetchToken?.({ forceRefreshToken: true })).not.toBe(
      "session-bearer-globex",
    );
    await waitFor(() => expect(result.current.get(globex.id)).toBe(7));
  });

  it("rotates the exchanged JWT and closes the badge client on a 401", async () => {
    const acme = profile("acme");
    const globex = profile("globex");
    state.tokens.set(globex.siteUrl, "session-bearer-globex");
    state.jwts.set(globex.siteUrl, ["convex-jwt-one", "convex-jwt-two", { reject: true }]);
    state.configs.set(globex.convexUrl, { capabilities: { workspaceUnread: true } });
    state.totals.set(globex.convexUrl, 3);

    const profiles = [acme, globex];
    const { result } = renderHook(() =>
      useWorkspaceUnreadCounts({
        profiles,
        activeProfileId: acme.id,
      }),
    );

    await waitFor(() => expect(state.watchCalls).toContain(globex.convexUrl));
    const client = state.clients.get(globex.convexUrl);
    await expect(client?.fetchToken?.({ forceRefreshToken: false })).resolves.toBe(
      "convex-jwt-one",
    );
    await expect(client?.fetchToken?.({ forceRefreshToken: true })).resolves.toBe("convex-jwt-two");
    await waitFor(() => expect(result.current.get(globex.id)).toBe(3));

    await expect(client?.fetchToken?.({ forceRefreshToken: true })).resolves.toBeNull();
    await waitFor(() => expect(client?.close).toHaveBeenCalled());
    expect(state.cleared).toContain(globex.siteUrl);
    await waitFor(() => expect(result.current.has(globex.id)).toBe(false));
  });

  it("skips a workspace without a stored token and an older server capability", async () => {
    const acme = profile("acme");
    const noToken = profile("no-token");
    const oldServer = profile("old-server");
    state.tokens.set(oldServer.siteUrl, "token-old");
    state.configs.set(oldServer.convexUrl, { capabilities: { mentionMarkers: true } });

    const { result } = renderHook(() =>
      useWorkspaceUnreadCounts({
        profiles: [acme, noToken, oldServer],
        activeProfileId: acme.id,
      }),
    );

    await waitFor(() => expect(state.clients.has(oldServer.convexUrl)).toBe(true));
    await waitFor(() => expect(state.clients.get(oldServer.convexUrl)?.close).toHaveBeenCalled());
    expect(state.clients.has(noToken.convexUrl)).toBe(false);
    expect(state.watchCalls).toEqual([]);
    expect(result.current.size).toBe(0);
  });

  it("contains a throwing localQueryResult so later updates still badge", async () => {
    const acme = profile("acme");
    const globex = profile("globex");
    state.tokens.set(globex.siteUrl, "session-bearer-globex");
    state.configs.set(globex.convexUrl, { capabilities: { workspaceUnread: true } });
    state.totals.set(globex.convexUrl, 9);
    state.resultThrows.set(globex.convexUrl, 1);

    const { result } = renderHook(() =>
      useWorkspaceUnreadCounts({
        profiles: [acme, globex],
        activeProfileId: acme.id,
      }),
    );

    await waitFor(() => expect(state.watchCalls).toContain(globex.convexUrl));
    expect(result.current.size).toBe(0);
    act(() => {
      for (const update of state.watchUpdates.get(globex.convexUrl) ?? []) {
        update();
      }
    });
    await waitFor(() => expect(result.current.get(globex.id)).toBe(9));
  });

  it("caps subscriptions and tears them down when the workspace changes or the page hides", async () => {
    const active = profile("active");
    const profiles = [
      active,
      profile("one"),
      profile("two"),
      profile("three"),
      profile("four"),
      profile("five"),
    ];
    for (const item of profiles.slice(1)) {
      state.tokens.set(item.siteUrl, `token-${item.id}`);
      state.configs.set(item.convexUrl, { capabilities: { workspaceUnread: true } });
      state.totals.set(item.convexUrl, 1);
    }

    const { result, rerender } = renderHook(
      ({ activeProfileId }: { activeProfileId: string }) =>
        useWorkspaceUnreadCounts({ profiles, activeProfileId }),
      { initialProps: { activeProfileId: active.id } },
    );

    await waitFor(() => expect(state.watchCalls).toHaveLength(MAX_WORKSPACE_BADGE_SUBSCRIPTIONS));
    expect(state.watchCalls).not.toContain(profiles[5]?.convexUrl);

    const first = state.clients.get(profiles[1]?.convexUrl ?? "");
    // Keep the new capability probes pending: old counts must be dropped
    // before fresh subscriptions can supply another workspace's badge.
    for (const item of profiles) {
      state.configs.set(item.convexUrl, new Promise(() => undefined));
    }
    rerender({ activeProfileId: profiles[1]?.id ?? "" });
    await waitFor(() => expect(first?.close).toHaveBeenCalled());
    expect(result.current.has(profiles[1]?.id ?? "")).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(result.current.size).toBe(0));
    for (const client of state.clients.values()) {
      expect(client.close).toHaveBeenCalled();
    }
  });
});
