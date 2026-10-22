import type { ChannelSummary } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { channelViewName } from "./channel-view-name";

const voice: ChannelSummary = {
  id: "c-voice",
  kind: "voice",
  categoryId: null,
  name: "standup",
  topic: null,
  archived: false,
};

describe("channelViewName", () => {
  it("uses the server's name before any name has been cached", () => {
    // The active channel on load is rendered before the eager pass caches its
    // name; showing the placeholder there was echoed back into the cache and
    // stuck ("standup" displayed as "channel" until the next reload).
    expect(channelViewName(voice, new Map())).toBe("standup");
  });

  it("prefers a cached name, which carries live renames", () => {
    expect(channelViewName(voice, new Map([["c-voice", "daily-standup"]]))).toBe("daily-standup");
  });

  it("falls back to a placeholder only when no name is known", () => {
    expect(channelViewName({ ...voice, name: null }, new Map())).toBe("channel");
    expect(channelViewName({ ...voice, kind: "dm", name: null }, new Map())).toBe("Direct message");
  });
});
