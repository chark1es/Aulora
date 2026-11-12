import { createServerProfile, type ServerProfile, type WellKnown } from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchState = vi.hoisted(() => ({
  ids: new Map<string, string | null>(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    private readonly url: string;
    constructor(url: string) {
      this.url = url;
    }
    async query(): Promise<{ pushRelay: { serverId?: string } }> {
      const id = fetchState.ids.get(new URL(this.url).host);
      if (id === null) throw new Error("unreachable");
      return { pushRelay: id === undefined ? {} : { serverId: id } };
    }
    close(): void {}
  },
}));

import { resolveWorkspaceProfile } from "../src/lib/workspace-identity";
import {
  configureWorkspaceNotificationStore,
  resetWorkspaceNotifications,
  workspaceServerIdIsAmbiguous,
} from "../src/lib/workspace-notifications";

function wellKnown(overrides: Partial<WellKnown> = {}): WellKnown {
  return {
    name: "Acme",
    version: "0.4.0",
    apiVersion: 1,
    convexUrl: "https://convex.acme.com",
    siteUrl: "https://chat.acme.com",
    iconSeed: "aulora:server:acme",
    auth: { local: { enabled: true, signup: true }, providers: [] },
    ...overrides,
  };
}

function profile(host: string, convex: string): ServerProfile {
  return createServerProfile(
    `https://${host}`,
    wellKnown({ siteUrl: `https://${host}`, convexUrl: `https://${convex}` }),
    1000,
  );
}

beforeEach(() => {
  configureWorkspaceNotificationStore(null);
  resetWorkspaceNotifications();
  fetchState.ids = new Map();
});

describe("resolveWorkspaceProfile", () => {
  it("does not choose the first of two uncached profiles that both advertise aulora", async () => {
    const acme = profile("chat.acme.com", "convex.acme.com");
    const globex = profile("chat.globex.com", "convex.globex.com");
    fetchState.ids = new Map([
      ["convex.acme.com", "aulora"],
      ["convex.globex.com", "aulora"],
    ]);

    await expect(resolveWorkspaceProfile([acme, globex], "aulora")).resolves.toBeUndefined();
    expect(workspaceServerIdIsAmbiguous("aulora")).toBe(true);
  });

  it("does not choose the first of two uncached profiles with a duplicate custom id", async () => {
    const acme = profile("chat.acme.com", "convex.acme.com");
    const globex = profile("chat.globex.com", "convex.globex.com");
    fetchState.ids = new Map([
      ["convex.acme.com", "6b1a0f8e-duplicate"],
      ["convex.globex.com", "6b1a0f8e-duplicate"],
    ]);

    await expect(
      resolveWorkspaceProfile([acme, globex], "6b1a0f8e-duplicate"),
    ).resolves.toBeUndefined();
    expect(workspaceServerIdIsAmbiguous("6b1a0f8e-duplicate")).toBe(true);
  });

  it("resolves a unique id only after every candidate identity is known", async () => {
    const acme = profile("chat.acme.com", "convex.acme.com");
    const globex = profile("chat.globex.com", "convex.globex.com");
    fetchState.ids = new Map([
      ["convex.acme.com", "srv-acme"],
      ["convex.globex.com", "srv-globex"],
    ]);

    await expect(resolveWorkspaceProfile([acme, globex], "srv-acme")).resolves.toBe(acme);
  });

  it("stays conservative when another candidate identity is inaccessible", async () => {
    const acme = profile("chat.acme.com", "convex.acme.com");
    const globex = profile("chat.globex.com", "convex.globex.com");
    fetchState.ids = new Map([
      ["convex.acme.com", "srv-acme"],
      ["convex.globex.com", null],
    ]);

    await expect(resolveWorkspaceProfile([acme, globex], "srv-acme")).resolves.toBeUndefined();
  });
});
