import type { ChannelSummary } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  type ChannelUnreadState,
  EAGER_CHANNEL_OPEN_CAP,
  selectEagerChannelIds,
} from "../lib/channel-priority";

function channel(id: string, overrides: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id,
    kind: "text",
    categoryId: null,
    name: id,
    topic: null,
    archived: false,
    ...overrides,
  };
}

function unread(extra: Partial<ChannelUnreadState> = {}): ChannelUnreadState {
  return { unread: true, mentionCount: 0, lastActivityAt: 1, ...extra };
}

describe("selectEagerChannelIds", () => {
  it("never returns more than the cap, however many channels exist", () => {
    const channels = Array.from({ length: 250 }, (_, index) => channel(`c${index}`));
    expect(selectEagerChannelIds(channels, new Map()).length).toBeLessThanOrEqual(
      EAGER_CHANNEL_OPEN_CAP,
    );
    expect(selectEagerChannelIds(channels, new Map()).length).toBe(EAGER_CHANNEL_OPEN_CAP);
  });

  it("prioritises the unread/mentioning conversations, most recent first", () => {
    const channels = [channel("a"), channel("b"), channel("c"), channel("d")];
    const unreadState = new Map<string, ChannelUnreadState>([
      ["b", unread({ lastActivityAt: 10 })],
      ["c", unread({ lastActivityAt: 30 })],
      ["d", unread({ lastActivityAt: 20, mentionCount: 2 })],
    ]);
    const ids = selectEagerChannelIds(channels, unreadState, 3);
    // c (30) then d (20, mentioned) then b (10); the read channel "a" is last.
    expect(ids.slice(0, 3)).toEqual(["c", "d", "b"]);
  });

  it("fills the remaining budget with ordinary conversations, skipping archived/hidden", () => {
    const channels = [
      channel("a", { archived: true }),
      channel("b", { hidden: true }),
      channel("c"),
      channel("d"),
    ];
    expect(selectEagerChannelIds(channels, new Map(), 3)).toEqual(["c", "d"]);
  });

  it("ignores unread state for channels that are not openable", () => {
    const channels = [channel("a", { archived: true }), channel("b")];
    const unreadState = new Map<string, ChannelUnreadState>([["a", unread()]]);
    expect(selectEagerChannelIds(channels, unreadState, 3)).toEqual(["b"]);
  });
});
