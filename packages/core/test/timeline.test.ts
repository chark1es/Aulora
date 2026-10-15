import { describe, expect, it } from "vitest";
import {
  activeTypers,
  activityLabel,
  badgeCount,
  buildTimeline,
  conversationTitle,
  createTypingThrottle,
  dayLabel,
  dmPartnerId,
  GROUP_WINDOW_MS,
  type MessagePayload,
  startOfLocalDay,
  type TimelineItem,
  typingLabel,
} from "../src/index";

const BASE = new Date(2026, 8, 25, 10, 0, 0).getTime();

function message(
  id: string,
  authorId: string,
  createdAt: number,
  extra: Partial<MessagePayload> = {},
): MessagePayload {
  return {
    id,
    channelId: "c1",
    authorId,
    body: "",
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt,
    ...extra,
  };
}

function shape(items: readonly TimelineItem[]): string[] {
  return items.map((item) => {
    if (item.kind === "message") {
      return `${item.message.id}${item.startsGroup ? "^" : ""}${item.endsGroup ? "$" : ""}`;
    }
    return item.kind;
  });
}

describe("buildTimeline", () => {
  it("returns nothing for an empty conversation", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it("groups consecutive messages by the same author into one run", () => {
    const items = buildTimeline([
      message("a", "u1", BASE),
      message("b", "u1", BASE + 30_000),
      message("c", "u1", BASE + 60_000),
      message("d", "u2", BASE + 90_000),
    ]);
    expect(shape(items)).toEqual(["day", "a^", "b", "c$", "d^$"]);
  });

  it("breaks a run after the grouping window", () => {
    const items = buildTimeline([
      message("a", "u1", BASE),
      message("b", "u1", BASE + GROUP_WINDOW_MS + 1),
    ]);
    expect(shape(items)).toEqual(["day", "a^$", "b^$"]);
  });

  it("starts a new run for every inline reply by the same author", () => {
    const items = buildTimeline([
      message("a", "u1", BASE),
      message("b", "u1", BASE + 1_000, { replyToId: "a" }),
      message("c", "u1", BASE + 2_000, { replyToId: "a" }),
      message("d", "u1", BASE + 3_000),
    ]);
    expect(shape(items)).toEqual(["day", "a^$", "b^$", "c^", "d$"]);
  });

  it("inserts a separator at each local day boundary and restarts the run", () => {
    const lateNight = new Date(2026, 8, 25, 23, 59, 0).getTime();
    const afterMidnight = new Date(2026, 8, 26, 0, 1, 0).getTime();
    const items = buildTimeline([message("a", "u1", lateNight), message("b", "u1", afterMidnight)]);
    expect(shape(items)).toEqual(["day", "a^$", "day", "b^$"]);
    expect(items[0]).toMatchObject({ kind: "day", dayStart: startOfLocalDay(lateNight) });
    expect(items[2]).toMatchObject({ kind: "day", dayStart: startOfLocalDay(afterMidnight) });
  });

  it("draws the unread divider above the first unread message and breaks the run", () => {
    const items = buildTimeline(
      [
        message("a", "u1", BASE),
        message("b", "u1", BASE + 1_000),
        message("c", "u1", BASE + 2_000),
      ],
      { firstUnreadId: "b" },
    );
    expect(shape(items)).toEqual(["day", "a^$", "unread", "b^", "c$"]);
  });

  it("omits deleted messages and groups their surviving neighbours", () => {
    const items = buildTimeline([
      message("a", "u1", BASE),
      message("b", "u1", BASE + 1_000, { deletedAt: BASE + 5_000 }),
      message("c", "u1", BASE + 2_000),
    ]);
    expect(shape(items)).toEqual(["day", "a^", "c$"]);
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 8, 25, 15, 0, 0).getTime();

  it("names today and yesterday", () => {
    expect(dayLabel(startOfLocalDay(now), now)).toBe("Today");
    expect(dayLabel(startOfLocalDay(now) - 1, now)).toBe("Yesterday");
  });

  it("uses the weekday within the last week", () => {
    const threeDaysAgo = new Date(2026, 8, 22).getTime();
    expect(dayLabel(threeDaysAgo, now)).toBe(
      new Date(threeDaysAgo).toLocaleDateString(undefined, { weekday: "long" }),
    );
  });

  it("includes the year only for other years", () => {
    const lastYear = new Date(2025, 0, 3).getTime();
    expect(dayLabel(lastYear, now)).toContain("2025");
    const thisYear = new Date(2026, 0, 3).getTime();
    expect(dayLabel(thisYear, now)).not.toContain("2026");
  });
});

describe("activityLabel", () => {
  const now = new Date(2026, 8, 25, 15, 0, 0).getTime();

  it("counts minutes and hours today", () => {
    expect(activityLabel(now - 10_000, now)).toBe("now");
    expect(activityLabel(now - 5 * 60_000, now)).toBe("5m");
    expect(activityLabel(now - 3 * 3_600_000, now)).toBe("3h");
  });

  it("never reports a future timestamp as negative", () => {
    expect(activityLabel(now + 60_000, now)).toBe("now");
  });

  it("switches to a weekday and then a date for older activity", () => {
    const twoDaysAgo = new Date(2026, 8, 23, 12, 0, 0).getTime();
    expect(activityLabel(twoDaysAgo, now)).toBe(
      new Date(twoDaysAgo).toLocaleDateString(undefined, { weekday: "short" }),
    );
    const monthAgo = new Date(2026, 7, 20, 12, 0, 0).getTime();
    expect(activityLabel(monthAgo, now)).toBe(
      new Date(monthAgo).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });
});

describe("badgeCount", () => {
  it("hides zero and caps large counts", () => {
    expect(badgeCount(0)).toBeNull();
    expect(badgeCount(7)).toBe("7");
    expect(badgeCount(120)).toBe("99+");
  });
});

describe("conversationTitle", () => {
  const names = new Map([
    ["me", "Me"],
    ["u1", "Kathryn"],
    ["u2", "Jacob"],
    ["u3", "Wade"],
    ["u4", "Leslie"],
  ]);
  const nameOf = (id: string) => names.get(id);

  it("uses the decrypted name for channels", () => {
    expect(conversationTitle({ kind: "text", name: "design" }, "me", nameOf)).toBe("design");
  });

  it("names a DM after the other participant", () => {
    expect(
      conversationTitle(
        { kind: "dm", name: "Direct message", memberIds: ["me", "u1"] },
        "me",
        nameOf,
      ),
    ).toBe("Kathryn");
  });

  it("lists group DM participants and summarises large groups", () => {
    expect(
      conversationTitle(
        { kind: "group_dm", name: "Group", memberIds: ["me", "u1", "u2"] },
        "me",
        nameOf,
      ),
    ).toBe("Kathryn, Jacob");
    expect(
      conversationTitle(
        { kind: "group_dm", name: "Group", memberIds: ["me", "u1", "u2", "u3", "u4"] },
        "me",
        nameOf,
      ),
    ).toBe("Kathryn, Jacob and 2 others");
  });

  it("falls back gracefully for unknown members and self-DMs", () => {
    expect(
      conversationTitle({ kind: "dm", name: "DM", memberIds: ["me", "zz"] }, "me", nameOf),
    ).toBe("Unknown member");
    expect(conversationTitle({ kind: "dm", name: "DM", memberIds: ["me"] }, "me", nameOf)).toBe(
      "Notes to self",
    );
    expect(conversationTitle({ kind: "dm", name: "Direct message" }, "me", nameOf)).toBe(
      "Direct message",
    );
  });
});

describe("dmPartnerId", () => {
  it("returns the other participant of a 1:1 DM only", () => {
    expect(dmPartnerId({ kind: "dm", memberIds: ["me", "u1"] }, "me")).toBe("u1");
    expect(dmPartnerId({ kind: "group_dm", memberIds: ["me", "u1", "u2"] }, "me")).toBeUndefined();
    expect(dmPartnerId({ kind: "text" }, "me")).toBeUndefined();
  });
});

describe("typing", () => {
  const now = 1_000_000;
  const rows = [
    { userId: "me", expiresAt: now + 5_000 },
    { userId: "u1", expiresAt: now + 5_000 },
    { userId: "u2", expiresAt: now - 1 },
  ];

  it("filters out the viewer and expired rows", () => {
    expect(activeTypers(rows, "me", now).map((row) => row.userId)).toEqual(["u1"]);
  });

  it("builds a readable typing line", () => {
    const nameOf = (id: string) => id.toUpperCase();
    expect(typingLabel(rows, "me", nameOf, now)).toBe("U1 is typing…");
    expect(typingLabel([], "me", nameOf, now)).toBeNull();
    expect(
      typingLabel(
        [
          { userId: "a", expiresAt: now + 1 },
          { userId: "b", expiresAt: now + 1 },
        ],
        "me",
        nameOf,
        now,
      ),
    ).toBe("A and B are typing…");
    expect(
      typingLabel(
        ["a", "b", "c"].map((userId) => ({ userId, expiresAt: now + 1 })),
        "me",
        nameOf,
        now,
      ),
    ).toBe("3 people are typing…");
  });

  it("throttles heartbeats per channel and re-arms on reset", () => {
    let clock = 0;
    const sent: string[] = [];
    const throttle = createTypingThrottle(
      (channelId) => sent.push(channelId),
      3_000,
      () => clock,
    );
    throttle.ping("c1");
    throttle.ping("c1");
    throttle.ping("c2");
    expect(sent).toEqual(["c1", "c2"]);
    clock = 2_999;
    throttle.ping("c1");
    expect(sent).toEqual(["c1", "c2"]);
    clock = 3_000;
    throttle.ping("c1");
    expect(sent).toEqual(["c1", "c2", "c1"]);
    throttle.reset("c1");
    throttle.ping("c1");
    expect(sent).toEqual(["c1", "c2", "c1", "c1"]);
  });
});
