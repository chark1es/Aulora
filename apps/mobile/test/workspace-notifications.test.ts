import { createServerProfile, type ServerProfile, type WellKnown } from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceUnread,
  profileForServerId,
  readWorkspaceNotificationHint,
  recordWorkspaceUnread,
  resetWorkspaceNotifications,
  setWorkspaceNotificationTarget,
  subscribeWorkspaceNotificationTargets,
  subscribeWorkspaceUnread,
  takeWorkspaceNotificationTarget,
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

beforeEach(() => {
  resetWorkspaceNotifications();
});

describe("readWorkspaceNotificationHint", () => {
  it("reads the APNs custom root", () => {
    expect(
      readWorkspaceNotificationHint({
        aulora: { serverId: "https://chat.acme.com", channelId: "c1", messageId: "m1" },
      }),
    ).toEqual({ serverId: "https://chat.acme.com", channelId: "c1", kind: "message" });
  });

  it("reads flattened FCM data and the call kind", () => {
    expect(
      readWorkspaceNotificationHint({
        serverId: "https://chat.acme.com",
        channelId: "c1",
        kind: "call",
      }),
    ).toEqual({ serverId: "https://chat.acme.com", channelId: "c1", kind: "call" });
  });

  it("ignores local notifications and malformed data", () => {
    expect(readWorkspaceNotificationHint({ channelId: "c1" })).toBeNull();
    expect(readWorkspaceNotificationHint({ serverId: "", channelId: "c1" })).toBeNull();
    expect(readWorkspaceNotificationHint(null)).toBeNull();
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

  it("ignores an unknown workspace", () => {
    expect(profileForServerId([profile("chat.acme.com")], "https://other.example")).toBeUndefined();
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
});

describe("notification conversation target", () => {
  it("hands the conversation only to the workspace it names", () => {
    setWorkspaceNotificationTarget("acme", "c1");
    expect(takeWorkspaceNotificationTarget("globex")).toBeUndefined();
    expect(takeWorkspaceNotificationTarget("acme")).toBe("c1");
    // Consumed once: a second mount does not reopen it.
    expect(takeWorkspaceNotificationTarget("acme")).toBeUndefined();
  });

  it("notifies a mounted workspace when a target arrives", () => {
    const listener = vi.fn();
    const off = subscribeWorkspaceNotificationTargets(listener);
    setWorkspaceNotificationTarget("acme", "c1");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
