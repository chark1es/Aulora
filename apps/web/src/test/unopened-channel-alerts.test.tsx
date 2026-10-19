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
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnreadState>;
  readonly eagerChannelIds?: ReadonlySet<string>;
  readonly activeChannelId?: string;
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
});
