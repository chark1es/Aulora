import { createServerProfile, type ServerProfile, type WellKnown } from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceUnread,
  configureWorkspaceNotificationStore,
  ensureWorkspaceNotificationsLoaded,
  profileForServerId,
  readWorkspaceNotificationHint,
  recordWorkspaceUnread,
  rememberAndPersistWorkspaceServerId,
  rememberWorkspaceServerId,
  resetWorkspaceNotifications,
  setWorkspaceNotificationTarget,
  subscribeWorkspaceNotificationTargets,
  subscribeWorkspaceUnread,
  takeWorkspaceNotificationTarget,
  workspaceNotificationWrites,
  workspaceServerIdForProfile,
  workspaceServerIdFromConfig,
  workspaceServerIdIsAmbiguous,
  workspaceUnreadSnapshot,
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

function profile(baseUrl: string, overrides: Partial<WellKnown> = {}): ServerProfile {
  return createServerProfile(baseUrl, wellKnown(overrides), 1000);
}

function memoryStore(initial: string | null = null) {
  let value = initial;
  return {
    store: {
      getItem: vi.fn(async () => value),
      setItem: vi.fn(async (_key: string, next: string) => {
        value = next;
      }),
    },
    read: () => value,
  };
}

beforeEach(() => {
  configureWorkspaceNotificationStore(null);
  resetWorkspaceNotifications();
});

describe("readWorkspaceNotificationHint", () => {
  it("reads the exact APNs payload the relay sends", () => {
    // Mirrors `contentFreePayload` nested under APNs' custom root.
    expect(
      readWorkspaceNotificationHint({
        aps: { alert: "New Aulora message", "mutable-content": 1 },
        aulora: {
          serverId: "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11",
          channelId: "jd7f2c9a1",
          messageId: "k57ab30cd",
          kind: "message",
        },
      }),
    ).toEqual({
      serverId: "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11",
      channelId: "jd7f2c9a1",
      messageId: "k57ab30cd",
      kind: "message",
    });
  });

  it("reads flattened FCM data, preserving the message id and call kind", () => {
    expect(
      readWorkspaceNotificationHint({
        serverId: "https://chat.acme.com",
        channelId: "c1",
        messageId: "m1",
        kind: "call",
      }),
    ).toEqual({
      serverId: "https://chat.acme.com",
      channelId: "c1",
      messageId: "m1",
      kind: "call",
    });
  });

  it("keeps a missing message id explicit instead of inventing one", () => {
    expect(readWorkspaceNotificationHint({ serverId: "s", channelId: "c" })).toEqual({
      serverId: "s",
      channelId: "c",
      messageId: null,
      kind: "message",
    });
  });

  it("ignores local notifications and malformed data", () => {
    expect(readWorkspaceNotificationHint({ channelId: "c1" })).toBeNull();
    expect(readWorkspaceNotificationHint({ serverId: "", channelId: "c1" })).toBeNull();
    expect(readWorkspaceNotificationHint(null)).toBeNull();
  });
});

describe("workspaceServerIdFromConfig", () => {
  it("reads the configured opaque id and the literal fallback", () => {
    expect(workspaceServerIdFromConfig({ pushRelay: { serverId: "aulora" } })).toBe("aulora");
    expect(
      workspaceServerIdFromConfig({
        pushRelay: { serverId: "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11" },
      }),
    ).toBe("6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11");
  });

  it("treats an older backend's missing field as unknown", () => {
    expect(workspaceServerIdFromConfig({})).toBeNull();
    expect(workspaceServerIdFromConfig({ pushRelay: { serverId: "" } })).toBeNull();
    expect(workspaceServerIdFromConfig({ pushRelay: { serverId: 7 } })).toBeNull();
    expect(workspaceServerIdFromConfig(null)).toBeNull();
  });
});

describe("profileForServerId", () => {
  it("matches the saved site address, tolerating a trailing slash", () => {
    const acme = profile("chat.acme.com");
    expect(profileForServerId([acme], "https://chat.acme.com/")).toBe(acme);
  });

  it("falls back to the origin when the saved address has a path", () => {
    const acme = profile("https://chat.acme.com/workspace", {
      siteUrl: "https://chat.acme.com/workspace",
    });
    expect(profileForServerId([acme], "https://chat.acme.com")).toBe(acme);
  });

  it("does not guess when two saved workspaces share an origin", () => {
    const one = profile("https://acme.com/one", { siteUrl: "https://acme.com/one" });
    const two = profile("https://acme.com/two", { siteUrl: "https://acme.com/two" });
    expect(profileForServerId([one, two], "https://acme.com")).toBeUndefined();
  });

  it("uses a remembered opaque AULORA_SERVER_ID once every saved identity is known", () => {
    const acme = profile("chat.acme.com");
    const globex = profile("https://chat.globex.com");
    expect(profileForServerId([acme, globex], "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11")).toBe(
      undefined,
    );
    rememberWorkspaceServerId(globex.id, "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11");
    // A partially cached opaque id is not proof: the other saved workspace has
    // not advertised anything yet and could share it.
    expect(profileForServerId([acme, globex], "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11")).toBe(
      undefined,
    );
    rememberWorkspaceServerId(acme.id, "srv-acme");
    expect(profileForServerId([acme, globex], "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11")).toBe(globex);
  });

  it("refuses an id advertised by two saved workspaces", () => {
    const acme = profile("chat.acme.com");
    const globex = profile("https://chat.globex.com");
    rememberWorkspaceServerId(acme.id, "aulora");
    rememberWorkspaceServerId(globex.id, "aulora");
    expect(workspaceServerIdIsAmbiguous("aulora")).toBe(true);
    expect(profileForServerId([acme, globex], "aulora")).toBeUndefined();
    // A single saved workspace can still recover from the legacy id.
    expect(profileForServerId([acme], "aulora")).toBe(acme);
  });

  it("clears a stale ambiguity when one duplicate workspace advertises a new id", () => {
    const acme = profile("chat.acme.com");
    const globex = profile("https://chat.globex.com");
    rememberWorkspaceServerId(acme.id, "aulora");
    rememberWorkspaceServerId(globex.id, "aulora");
    expect(workspaceServerIdIsAmbiguous("aulora")).toBe(true);

    // The operator configures a unique AULORA_SERVER_ID on globex.
    rememberAndPersistWorkspaceServerId(globex.id, "srv-globex");
    expect(workspaceServerIdIsAmbiguous("aulora")).toBe(false);
    expect(profileForServerId([acme, globex], "aulora")).toBe(acme);
    expect(profileForServerId([acme, globex], "srv-globex")).toBe(globex);
  });

  it("resolves the historical literal id only when one workspace is saved", () => {
    const acme = profile("chat.acme.com");
    expect(profileForServerId([acme], "aulora")).toBe(acme);
    expect(
      profileForServerId([acme, profile("https://chat.globex.com")], "aulora"),
    ).toBeUndefined();
  });

  it("resolves an unknown opaque id to the only saved workspace", () => {
    // The device can only have registered for a workspace it saved; with one
    // profile, an old id shape cannot mean anything else.
    const acme = profile("chat.acme.com");
    expect(profileForServerId([acme], "some-old-opaque-id")).toBe(acme);
  });

  it("ignores an unknown workspace when several are saved", () => {
    expect(
      profileForServerId([profile("chat.acme.com"), profile("https://chat.globex.com")], "unknown"),
    ).toBeUndefined();
  });
});

describe("workspace nav badge", () => {
  it("counts wakes per workspace and clears the opened one", () => {
    const listener = vi.fn();
    const off = subscribeWorkspaceUnread(listener);
    recordWorkspaceUnread("acme");
    recordWorkspaceUnread("acme");
    recordWorkspaceUnread("globex");
    expect(workspaceUnreadSnapshot().get("acme")).toBe(2);
    expect(workspaceUnreadSnapshot().get("globex")).toBe(1);
    expect(listener).toHaveBeenCalledTimes(3);

    clearWorkspaceUnread("acme");
    expect(workspaceUnreadSnapshot().has("acme")).toBe(false);
    // Clearing a workspace with no badge is a no-op, not a listener storm.
    clearWorkspaceUnread("acme");
    expect(listener).toHaveBeenCalledTimes(4);
    off();
  });

  it("persists badges so a process restart does not forget them", async () => {
    const { store, read } = memoryStore();
    configureWorkspaceNotificationStore(store);
    recordWorkspaceUnread("acme");
    recordWorkspaceUnread("acme");
    recordWorkspaceUnread("globex");
    await workspaceNotificationWrites();
    expect(JSON.parse(read() ?? "{}")).toMatchObject({
      unread: { acme: 2, globex: 1 },
    });

    // A fresh process reads the same store.
    resetWorkspaceNotifications();
    configureWorkspaceNotificationStore(store);
    await ensureWorkspaceNotificationsLoaded();
    expect(workspaceUnreadSnapshot().get("acme")).toBe(2);
    expect(workspaceUnreadSnapshot().get("globex")).toBe(1);
  });

  it("ignores corrupt persistence instead of throwing", async () => {
    const { store } = memoryStore("not json");
    configureWorkspaceNotificationStore(store);
    await expect(ensureWorkspaceNotificationsLoaded()).resolves.toBeUndefined();
    expect(workspaceUnreadSnapshot().size).toBe(0);
  });
});

describe("workspace identity persistence", () => {
  it("saves a learned server id and restores it after a restart", async () => {
    const acme = profile("chat.acme.com");
    const { store, read } = memoryStore();
    configureWorkspaceNotificationStore(store);
    rememberAndPersistWorkspaceServerId(acme.id, "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11");
    await workspaceNotificationWrites();
    expect(JSON.parse(read() ?? "{}").serverIds[acme.id]).toBe(
      "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11",
    );

    resetWorkspaceNotifications();
    expect(workspaceServerIdForProfile(acme.id)).toBeUndefined();
    configureWorkspaceNotificationStore(store);
    await ensureWorkspaceNotificationsLoaded();
    expect(workspaceServerIdForProfile(acme.id)).toBe("6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11");
    expect(profileForServerId([acme], "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11")).toBe(acme);
  });

  it("loads an id written by an earlier launch before a launch response resolves", async () => {
    const globex = profile("https://chat.globex.com");
    const acme = profile("chat.acme.com");
    const { store } = memoryStore(
      JSON.stringify({
        serverIds: { [acme.id]: "srv-acme", [globex.id]: "srv-globex" },
        unread: { [globex.id]: 3 },
      }),
    );
    configureWorkspaceNotificationStore(store);
    await ensureWorkspaceNotificationsLoaded();
    expect(profileForServerId([acme, globex], "srv-globex")).toBe(globex);
    expect(workspaceUnreadSnapshot().get(globex.id)).toBe(3);
  });
});

describe("notification conversation target", () => {
  it("carries the exact channel and message only to the workspace it names", () => {
    setWorkspaceNotificationTarget("acme", "c1", "m1", "message");
    expect(takeWorkspaceNotificationTarget("globex")).toBeUndefined();
    expect(takeWorkspaceNotificationTarget("acme")).toEqual({
      profileId: "acme",
      channelId: "c1",
      messageId: "m1",
      kind: "message",
    });
    // Consumed once: a second mount does not reopen it.
    expect(takeWorkspaceNotificationTarget("acme")).toBeUndefined();
  });

  it("keeps a call target but never a message jump", () => {
    setWorkspaceNotificationTarget("acme", "c1", null, "call");
    expect(takeWorkspaceNotificationTarget("acme")).toEqual({
      profileId: "acme",
      channelId: "c1",
      messageId: null,
      kind: "call",
    });
  });

  it("notifies a mounted workspace when a target arrives", () => {
    const listener = vi.fn();
    const off = subscribeWorkspaceNotificationTargets(listener);
    setWorkspaceNotificationTarget("acme", "c1");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
