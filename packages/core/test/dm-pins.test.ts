import { type ChannelSummary, partitionPinnedDms } from "@aulora/core";
import { describe, expect, it } from "vitest";

function dm(id: string, extra: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id,
    kind: "dm",
    categoryId: null,
    name: "Direct message",
    topic: null,
    archived: false,
    ...extra,
  };
}

describe("partitionPinnedDms", () => {
  it("lifts pinned conversations ahead of the rest, oldest pin first", () => {
    const channels = [
      dm("a", { pinned: true, pinnedAt: 300 }),
      dm("b"),
      dm("c", { pinned: true, pinnedAt: 100 }),
      dm("d"),
    ];

    const groups = partitionPinnedDms(channels);

    expect(groups.pinned.map((entry) => entry.id)).toEqual(["c", "a"]);
    expect(groups.others.map((entry) => entry.id)).toEqual(["b", "d"]);
  });

  it("keeps the incoming order for ties and for unpinned conversations", () => {
    const channels = [
      dm("first"),
      dm("pin-x", { pinned: true, pinnedAt: 50 }),
      dm("second"),
      dm("pin-y", { pinned: true, pinnedAt: 50 }),
    ];

    const groups = partitionPinnedDms(channels);

    expect(groups.pinned.map((entry) => entry.id)).toEqual(["pin-x", "pin-y"]);
    expect(groups.others.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("treats a missing pinnedAt as the earliest pin", () => {
    const channels = [dm("dated", { pinned: true, pinnedAt: 10 }), dm("undated", { pinned: true })];

    const groups = partitionPinnedDms(channels);

    expect(groups.pinned.map((entry) => entry.id)).toEqual(["undated", "dated"]);
  });

  it("returns everything under others when nothing is pinned", () => {
    const groups = partitionPinnedDms([dm("a"), dm("b")]);

    expect(groups.pinned).toEqual([]);
    expect(groups.others.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
