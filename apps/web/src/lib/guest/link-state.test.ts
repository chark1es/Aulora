import { describe, expect, it } from "vitest";
import {
  GUEST_LINK_EXPIRY_OPTIONS,
  guestLinkState,
  linksQueryArgs,
  parseMaxUses,
  showsLinkList,
} from "./link-state";

const NOW = 1_000_000;
const live = { expiresAt: NOW + 60_000, maxUses: 5, uses: 1, revoked: false };

describe("guestLinkState", () => {
  it("is active while unrevoked, unexpired and under its use cap", () => {
    expect(guestLinkState(live, NOW)).toBe("active");
  });

  it("reports each unusable state", () => {
    expect(guestLinkState({ ...live, revoked: true }, NOW)).toBe("revoked");
    expect(guestLinkState({ ...live, expiresAt: NOW }, NOW)).toBe("expired");
    expect(guestLinkState({ ...live, uses: 5 }, NOW)).toBe("used-up");
  });

  it("lets revocation outrank expiry and exhaustion", () => {
    expect(guestLinkState({ expiresAt: NOW - 1, maxUses: 1, uses: 1, revoked: true }, NOW)).toBe(
      "revoked",
    );
    expect(guestLinkState({ expiresAt: NOW - 1, maxUses: 1, uses: 1, revoked: false }, NOW)).toBe(
      "expired",
    );
  });
});

describe("invite form values", () => {
  it("accepts 1 to 25 people and nothing else", () => {
    expect(parseMaxUses("5")).toBe(5);
    expect(parseMaxUses(" 25 ")).toBe(25);
    for (const bad of ["0", "26", "-1", "2.5", "", "abc", "1e2", "0005000"]) {
      expect(parseMaxUses(bad)).toBeNull();
    }
  });

  it("offers lifetimes inside the server's 1 minute to 7 days range, ascending", () => {
    const values = GUEST_LINK_EXPIRY_OPTIONS.map((option) => option.ms);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(60_000);
    expect(Math.max(...values)).toBeLessThanOrEqual(7 * 24 * 3_600_000);
  });
});

describe("linksQueryArgs", () => {
  it("lists a scheduled call by its own id, with or without a live call", () => {
    expect(linksQueryArgs({ scheduledCallId: "sc1" }, null, undefined)).toEqual({
      scheduledCallId: "sc1",
    });
    expect(linksQueryArgs({ scheduledCallId: "sc1" }, "call1", false)).toEqual({
      scheduledCallId: "sc1",
    });
    expect(showsLinkList({ scheduledCallId: "sc1" }, null, undefined)).toBe(true);
  });

  it("lists a channel call by its call id, only for a lobby manager", () => {
    expect(linksQueryArgs({ channelId: "ch1" }, "call1", true)).toEqual({ callId: "call1" });
    expect(linksQueryArgs({ channelId: "ch1" }, "call1", false)).toBe("skip");
    expect(linksQueryArgs({ channelId: "ch1" }, "call1", undefined)).toBe("skip");
    expect(linksQueryArgs({ channelId: "ch1" }, null, true)).toBe("skip");
    expect(showsLinkList({ channelId: "ch1" }, "call1", false)).toBe(false);
  });

  it("never sends both ids, and never an empty scheduled id", () => {
    const args = linksQueryArgs({ channelId: "ch1", scheduledCallId: "sc1" }, "call1", true);
    expect(args).toEqual({ scheduledCallId: "sc1" });
    expect(linksQueryArgs({ scheduledCallId: "" }, null, true)).toBe("skip");
  });
});
