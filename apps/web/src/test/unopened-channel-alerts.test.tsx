import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelUnreadState } from "../lib/channel-priority";

const mocks = vi.hoisted(() => ({ playSound: vi.fn(), notify: vi.fn() }));

vi.mock("../lib/sounds", () => ({ playSound: mocks.playSound }));
vi.mock("../lib/use-desktop-notifications", () => ({
  showUnfocusedNotification: mocks.notify,
}));

import { useUnopenedChannelAlerts } from "../lib/use-unopened-channel-alerts";

function state(extra: Partial<ChannelUnreadState> = {}): ChannelUnreadState {
  return { unread: true, mentionCount: 0, lastActivityAt: 1, ...extra };
}

interface HookProps {
  readonly suppressionPrefs?: import("../lib/use-unopened-channel-alerts").UnopenedChannelAlertsOptions["suppressionPrefs"];
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnreadState>;
  readonly eagerChannelIds?: ReadonlySet<string>;
  readonly activeChannelId?: string;
  readonly activeChannelVisible?: boolean;
  readonly mutedChannelIds?: ReadonlySet<string>;
}

const base = {
  eagerChannelIds: new Set<string>(),
  activeChannelId: undefined,
  mutedChannelIds: new Set<string>(),
  channelNames: new Map([["b", "chan-b"]]),
};

function renderAlerts(initialProps: HookProps) {
  return renderHook(
    ({ eagerChannelIds, activeChannelId, mutedChannelIds, ...rest }: HookProps) =>
      useUnopenedChannelAlerts({
        ...base,
        ...(eagerChannelIds !== undefined ? { eagerChannelIds } : {}),
        ...(activeChannelId !== undefined ? { activeChannelId } : {}),
        ...(mutedChannelIds !== undefined ? { mutedChannelIds } : {}),
        ...rest,
      }),
    { initialProps },
  );
}

describe("useUnopenedChannelAlerts", () => {
  beforeEach(() => {
    mocks.playSound.mockClear();
    mocks.notify.mockClear();
  });

  it("seeds from the first snapshot without alerting on existing history", () => {
    renderAlerts({ unreadByChannel: new Map([["b", state()]]) });
    expect(mocks.playSound).not.toHaveBeenCalled();
  });

  it("chimes for a channel that gains unread activity after seeding", () => {
    const { rerender } = renderAlerts({
      unreadByChannel: new Map([["b", state({ lastActivityAt: 1 })]]),
    });
    rerender({ unreadByChannel: new Map([["b", state({ lastActivityAt: 2 })]]) });
    expect(mocks.playSound).toHaveBeenCalledWith("message");
  });

  it("uses the mention chime when the mention count rises", () => {
    const { rerender } = renderAlerts({
      unreadByChannel: new Map([["b", state({ mentionCount: 0 })]]),
    });
    rerender({ unreadByChannel: new Map([["b", state({ mentionCount: 1 })]]) });
    expect(mocks.playSound).toHaveBeenCalledWith("mention");
  });

  it("skips channels that are eagerly open, currently open, or muted", () => {
    const { rerender } = renderAlerts({
      unreadByChannel: new Map([["eager", state()]]),
      eagerChannelIds: new Set(["eager"]),
      activeChannelId: "active",
      mutedChannelIds: new Set(["muted"]),
    });
    rerender({
      unreadByChannel: new Map([
        ["eager", state({ lastActivityAt: 2 })],
        ["active", state({ lastActivityAt: 2 })],
        ["muted", state({ lastActivityAt: 2 })],
      ]),
      eagerChannelIds: new Set(["eager"]),
      activeChannelId: "active",
      mutedChannelIds: new Set(["muted"]),
    });
    expect(mocks.playSound).not.toHaveBeenCalled();
  });

  it("alerts for the open conversation when its canvas is hidden", () => {
    const { rerender } = renderAlerts({
      unreadByChannel: new Map([["b", state()]]),
      activeChannelId: "b",
      activeChannelVisible: true,
    });
    rerender({
      unreadByChannel: new Map([["b", state({ lastActivityAt: 2 })]]),
      activeChannelId: "b",
      activeChannelVisible: false,
    });
    expect(mocks.playSound).toHaveBeenCalledWith("message");
  });

  it("stays quiet for the open conversation while its canvas is visible", () => {
    const { rerender } = renderAlerts({
      unreadByChannel: new Map([["b", state()]]),
      activeChannelId: "b",
      activeChannelVisible: false,
    });
    rerender({
      unreadByChannel: new Map([["b", state({ lastActivityAt: 2 })]]),
      activeChannelId: "b",
      activeChannelVisible: true,
    });
    expect(mocks.playSound).not.toHaveBeenCalled();
  });
});

it("suppresses summary mention alerts and honors a channel override", () => {
  mocks.playSound.mockClear();
  const suppressionPrefs = [
    { scope: "server", channelId: null, suppressMassMentions: true },
    { scope: "channel", channelId: "allowed", suppressMassMentions: false },
  ];
  const { rerender } = renderAlerts({ unreadByChannel: new Map(), suppressionPrefs });
  rerender({ unreadByChannel: new Map([["b", state({ mentionCount: 1 })]]), suppressionPrefs });
  expect(mocks.playSound).not.toHaveBeenCalled();
  rerender({
    unreadByChannel: new Map([["allowed", state({ mentionCount: 1 })]]),
    suppressionPrefs,
  });
  expect(mocks.playSound).toHaveBeenCalledWith("mention");
});

it("keeps direct mentions audible when mass mentions are suppressed", () => {
  mocks.playSound.mockClear();
  const suppressionPrefs = [{ scope: "server", channelId: null, suppressMassMentions: true }];
  const { rerender } = renderAlerts({ unreadByChannel: new Map(), suppressionPrefs });
  rerender({
    unreadByChannel: new Map([["b", state({ mentionCount: 1, massMentionCount: 0 })]]),
    suppressionPrefs,
  });
  expect(mocks.playSound).toHaveBeenCalledWith("mention");
});
