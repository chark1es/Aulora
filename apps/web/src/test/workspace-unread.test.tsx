import type { ServerProfile } from "@aulora/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tokens: new Map<string, string | null>(),
  configs: new Map<string, unknown>(),
  totals: new Map<string, number>(),
  clients: new Map<string, MockClient>(),
  watchCalls: [] as string[],
}));

vi.mock("../lib/session-token", () => ({
  readSessionToken: (siteUrl: string) => state.tokens.get(siteUrl) ?? null,
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    readonly url: string;
    readonly close = vi.fn();
    readonly setAuth = vi.fn();
    constructor(url: string) {
      this.url = url;
      state.clients.set(url, this as unknown as MockClient);
    }
    async query(): Promise<unknown> {
      return state.configs.get(this.url) ?? {};
    }
    watchQuery(): {
      onUpdate: (callback: () => void) => () => void;
      localQueryResult: () => { total: number } | undefined;
    } {
      state.watchCalls.push(this.url);
      return {
        onUpdate: () => () => undefined,
        localQueryResult: () => ({ total: state.totals.get(this.url) ?? 0 }),
      };
    }
  },
}));

import {
  MAX_WORKSPACE_BADGE_SUBSCRIPTIONS,
  useWorkspaceUnreadCounts,
} from "../lib/use-workspace-unread";

interface MockClient {
  readonly url: string;
  readonly close: ReturnType<typeof vi.fn>;
  readonly setAuth: ReturnType<typeof vi.fn>;
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
  state.clients = new Map();
  state.watchCalls = [];
});

describe("useWorkspaceUnreadCounts", () => {
  it("badges another saved workspace through its own authenticated client", async () => {
    const acme = profile("acme");
    const globex = profile("globex");
    state.tokens.set(globex.siteUrl, "token-globex");
    state.configs.set(globex.convexUrl, { capabilities: { workspaceUnread: true } });
    state.totals.set(globex.convexUrl, 7);

    const { result } = renderHook(() =>
      useWorkspaceUnreadCounts({
        profiles: [acme, globex],
        activeProfileId: acme.id,
      }),
    );

    await waitFor(() => expect(state.watchCalls).toContain(globex.convexUrl));
    expect(state.clients.get(globex.convexUrl)?.setAuth).toHaveBeenCalled();
    await waitFor(() => expect(result.current.get(globex.id)).toBe(7));
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
