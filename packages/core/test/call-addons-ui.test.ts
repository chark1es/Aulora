import { describe, expect, it } from "vitest";
import {
  addonFlagsOf,
  canCreateGuestLinks,
  canDeleteTranscripts,
  canEditScheduledCall,
  canManageGuestAccess,
  canScheduleCalls,
  canStartTranscription,
  canViewScheduledCalls,
  canViewTranscripts,
} from "../src/call-addons-access";
import { Permission } from "../src/permissions";
import {
  formatCallTimeRange,
  formatLocalDateTime,
  formatLocalTime,
  formatLocalTimeWithZone,
  formatOpensIn,
  formatZoneName,
  fromDateTimeLocalValue,
  groupByLocalDay,
  localDayKey,
  nextCountdownTickMs,
  notOpenMessage,
  parseScheduledCallNotOpen,
  scheduledJoinState,
  splitScheduledCalls,
  toDateTimeLocalValue,
} from "../src/scheduled-calls-view";
import {
  formatTranscriptTime,
  groupTranscriptTurns,
  parseTranscriptSummary,
} from "../src/transcript-view";

const NY = { timeZone: "America/New_York", locale: "en-US" } as const;
const BERLIN = { timeZone: "Europe/Berlin", locale: "en-US" } as const;
const KOLKATA = { timeZone: "Asia/Kolkata", locale: "en-US" } as const;

describe("local time formatting", () => {
  it("renders the same instant in each viewer's zone with its zone name", () => {
    const instant = Date.UTC(2026, 10, 9, 20, 30);
    expect(formatLocalTime(instant, NY)).toBe("3:30 PM");
    expect(formatZoneName(instant, NY)).toBe("EST");
    expect(formatLocalTime(instant, BERLIN)).toBe("9:30 PM");
    expect(formatLocalTimeWithZone(instant, KOLKATA)).toMatch(/^2:00 AM GMT\+5:30$/u);
  });

  it("follows daylight saving: one wall time, two offsets", () => {
    const winter = Date.UTC(2026, 0, 15, 17, 0);
    const summer = Date.UTC(2026, 6, 15, 17, 0);
    expect(formatLocalTimeWithZone(winter, NY)).toBe("12:00 PM EST");
    expect(formatLocalTimeWithZone(summer, NY)).toBe("1:00 PM EDT");
  });

  it("omits the year for this year and shows it otherwise", () => {
    const now = Date.UTC(2026, 10, 9, 12, 0);
    expect(formatLocalDateTime(Date.UTC(2026, 10, 12, 18, 0), now, NY)).toBe(
      "Thu, Nov 12, 1:00 PM EST",
    );
    expect(formatLocalDateTime(Date.UTC(2027, 0, 12, 18, 0), now, NY)).toContain("2027");
  });
});

describe("datetime-local conversion", () => {
  it("round-trips an ordinary wall time", () => {
    const instant = fromDateTimeLocalValue("2026-11-09T15:30", NY);
    expect(instant).toBe(Date.UTC(2026, 10, 9, 20, 30));
    expect(toDateTimeLocalValue(instant ?? 0, NY)).toBe("2026-11-09T15:30");
  });

  it("handles half-hour zones", () => {
    expect(fromDateTimeLocalValue("2026-11-09T02:00", KOLKATA)).toBe(Date.UTC(2026, 10, 8, 20, 30));
  });

  it("resolves a time skipped by spring-forward to the first instant after the gap", () => {
    // 2026-03-08 02:30 does not exist in New York (clocks jump 02:00 -> 03:00).
    const instant = fromDateTimeLocalValue("2026-03-08T02:30", NY);
    expect(instant).not.toBeNull();
    const wall = toDateTimeLocalValue(instant ?? 0, NY);
    expect(wall >= "2026-03-08T03:00").toBe(true);
    expect(wall <= "2026-03-08T03:30").toBe(true);
  });

  it("picks the first occurrence of an ambiguous fall-back time", () => {
    // 2026-11-01 01:30 happens twice in New York; the first is still EDT.
    const instant = fromDateTimeLocalValue("2026-11-01T01:30", NY);
    expect(instant).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(formatZoneName(instant ?? 0, NY)).toBe("EDT");
  });

  it("keeps a fixed wall time across the DST boundary", () => {
    const before = fromDateTimeLocalValue("2026-03-07T09:00", NY) ?? 0;
    const after = fromDateTimeLocalValue("2026-03-09T09:00", NY) ?? 0;
    // 48 elapsed hours minus the lost hour.
    expect(after - before).toBe(47 * 3_600_000);
  });

  it("rejects values that are not real calendar times", () => {
    expect(fromDateTimeLocalValue("2026-02-30T10:00", NY)).toBeNull();
    expect(fromDateTimeLocalValue("2026-11-09T25:00", NY)).toBeNull();
    expect(fromDateTimeLocalValue("tomorrow", NY)).toBeNull();
    expect(fromDateTimeLocalValue("", NY)).toBeNull();
  });
});

describe("grouping by local day", () => {
  it("keys the day in the viewer's zone, not UTC", () => {
    // 03:30 UTC on Nov 10 is still the evening of Nov 9 in New York.
    const instant = Date.UTC(2026, 10, 10, 3, 30);
    expect(localDayKey(instant, NY)).toBe("2026-11-09");
    expect(localDayKey(instant, BERLIN)).toBe("2026-11-10");
  });

  it("groups upcoming calls with relative labels and keeps order", () => {
    const now = Date.UTC(2026, 10, 9, 15, 0);
    const calls = [
      { id: "c", startsAt: Date.UTC(2026, 10, 11, 18, 0) },
      { id: "a", startsAt: Date.UTC(2026, 10, 9, 21, 0) },
      { id: "b", startsAt: Date.UTC(2026, 10, 10, 15, 0) },
      { id: "a2", startsAt: Date.UTC(2026, 10, 9, 23, 0) },
    ];
    const groups = groupByLocalDay(calls, (call) => call.startsAt, now, "asc", NY);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Tomorrow", "Wed, Nov 11"]);
    expect(groups[0]?.items.map((call) => call.id)).toEqual(["a", "a2"]);
  });

  it("labels tomorrow correctly on a 25-hour fall-back day", () => {
    // 2026-11-01 is 25 hours long in New York; 11 PM that evening, tomorrow is Nov 2.
    const now = Date.UTC(2026, 10, 2, 4, 30);
    const groups = groupByLocalDay(
      [{ startsAt: Date.UTC(2026, 10, 2, 15, 0) }],
      (call) => call.startsAt,
      now,
      "asc",
      NY,
    );
    expect(groups[0]?.label).toBe("Tomorrow");
  });

  it("orders past calls newest first and labels yesterday", () => {
    const now = Date.UTC(2026, 10, 9, 15, 0);
    const calls = [
      { id: "old", startsAt: Date.UTC(2026, 10, 1, 18, 0) },
      { id: "yesterday", startsAt: Date.UTC(2026, 10, 8, 18, 0) },
    ];
    const groups = groupByLocalDay(calls, (call) => call.startsAt, now, "desc", NY);
    expect(groups.map((group) => group.items[0]?.id)).toEqual(["yesterday", "old"]);
    expect(groups[0]?.label).toBe("Yesterday");
  });
});

describe("join window", () => {
  const startsAt = Date.UTC(2026, 10, 9, 20, 0);
  const call = { status: "scheduled", startsAt, openLeadMinutes: 5 } as const;

  it("is not open until the lead time, with the open instant", () => {
    const state = scheduledJoinState(call, startsAt - 6 * 60_000);
    expect(state).toEqual({ kind: "not-open", opensAt: startsAt - 5 * 60_000, opensInMs: 60_000 });
  });

  it("opens exactly at the lead time and stays open after the start", () => {
    expect(scheduledJoinState(call, startsAt - 5 * 60_000).kind).toBe("open");
    expect(scheduledJoinState(call, startsAt + 3_600_000).kind).toBe("open");
  });

  it("honours a zero lead and a server-opened call", () => {
    expect(scheduledJoinState({ ...call, openLeadMinutes: 0 }, startsAt - 1).kind).toBe("not-open");
    expect(scheduledJoinState({ ...call, status: "open" }, 0).kind).toBe("open");
  });

  it("refuses cancelled and ended calls", () => {
    expect(scheduledJoinState({ ...call, status: "cancelled" }, startsAt).kind).toBe("cancelled");
    expect(scheduledJoinState({ ...call, status: "ended" }, startsAt).kind).toBe("ended");
    expect(scheduledJoinState({ ...call, canJoin: false }, startsAt).kind).toBe("ended");
  });

  it("words the countdown and paces its ticks", () => {
    expect(formatOpensIn(30_000)).toBe("in under a minute");
    expect(formatOpensIn(4 * 60_000 + 5_000)).toBe("in 4 min");
    expect(formatOpensIn(3 * 3_600_000 + 5 * 60_000)).toBe("in 3 h 5 min");
    expect(formatOpensIn(3 * 3_600_000)).toBe("in 3 h");
    expect(formatOpensIn(3 * 86_400_000)).toBe("in 3 days");
    expect(nextCountdownTickMs(30_000)).toBe(1_000);
    expect(nextCountdownTickMs(10 * 60_000)).toBeLessThanOrEqual(60_000);
    expect(nextCountdownTickMs(10 * 60_000)).toBeGreaterThanOrEqual(1_000);
  });
});

describe("ScheduledCallNotOpen error", () => {
  const data = {
    code: "ScheduledCallNotOpen",
    message: "This call hasn't started yet",
    startsAt: Date.UTC(2026, 10, 9, 20, 0),
    opensAt: Date.UTC(2026, 10, 9, 19, 55),
  };

  it("reads the structured payload from error.data, object or JSON text", () => {
    expect(parseScheduledCallNotOpen({ data })).toEqual({
      startsAt: data.startsAt,
      opensAt: data.opensAt,
    });
    expect(parseScheduledCallNotOpen({ data: JSON.stringify(data) })).toEqual({
      startsAt: data.startsAt,
      opensAt: data.opensAt,
    });
  });

  it("ignores every other error", () => {
    expect(parseScheduledCallNotOpen(new Error("This call is full"))).toBeNull();
    expect(parseScheduledCallNotOpen({ data: "This call is full" })).toBeNull();
    expect(parseScheduledCallNotOpen({ data: { code: "Other" } })).toBeNull();
    expect(parseScheduledCallNotOpen({ data: { ...data, opensAt: "soon" } })).toBeNull();
    expect(parseScheduledCallNotOpen(null)).toBeNull();
  });

  it("renders the open time in the viewer's zone", () => {
    const message = notOpenMessage({ startsAt: data.startsAt, opensAt: data.opensAt }, NY);
    expect(message).toBe("This call hasn't started yet — opens at 2:55 PM EST");
  });
});

describe("addon permission gating", () => {
  const none = 0n;
  it("hides every control by default", () => {
    expect(
      canStartTranscription({
        permissions: none,
        addonEnabled: true,
        modelReady: true,
        inCall: true,
      }),
    ).toBe(false);
    expect(canViewTranscripts(none, true)).toBe(false);
    expect(canDeleteTranscripts(none)).toBe(false);
    expect(canCreateGuestLinks(none, true)).toBe(false);
    expect(canManageGuestAccess(none, true)).toBe(false);
    expect(canScheduleCalls(none, true)).toBe(false);
    expect(canViewScheduledCalls(none, true)).toBe(false);
  });

  it("needs the permission and the addon and a ready model", () => {
    const start = Permission.StartTranscription;
    const base = { permissions: start, addonEnabled: true, modelReady: true, inCall: true };
    expect(canStartTranscription(base)).toBe(true);
    expect(canStartTranscription({ ...base, addonEnabled: false })).toBe(false);
    expect(canStartTranscription({ ...base, modelReady: false })).toBe(false);
    expect(canStartTranscription({ ...base, inCall: false })).toBe(false);
    expect(canViewTranscripts(Permission.ViewTranscripts, false)).toBe(false);
    expect(canViewTranscripts(Permission.ViewTranscripts, true)).toBe(true);
    expect(canCreateGuestLinks(Permission.CreateGuestLinks, false)).toBe(false);
  });

  it("treats administrators as holding everything", () => {
    const admin = Permission.Administrator;
    expect(
      canStartTranscription({
        permissions: admin,
        addonEnabled: true,
        modelReady: true,
        inCall: true,
      }),
    ).toBe(true);
    expect(canScheduleCalls(admin, true)).toBe(true);
    expect(canDeleteTranscripts(admin)).toBe(true);
  });

  it("lets either schedule permission create", () => {
    expect(canScheduleCalls(Permission.ScheduleCalls, true)).toBe(true);
    expect(canScheduleCalls(Permission.ManageScheduledCalls, true)).toBe(true);
    expect(canScheduleCalls(Permission.ViewScheduledCalls, true)).toBe(false);
  });

  it("limits edit and cancel to calls the server says the viewer manages", () => {
    expect(canEditScheduledCall({ canManage: false, status: "scheduled" })).toEqual({
      edit: false,
      cancel: false,
    });
    expect(canEditScheduledCall({ canManage: true, status: "scheduled" })).toEqual({
      edit: true,
      cancel: true,
    });
    expect(canEditScheduledCall({ canManage: true, status: "open" })).toEqual({
      edit: false,
      cancel: true,
    });
    expect(canEditScheduledCall({ canManage: true, status: "ended" })).toEqual({
      edit: false,
      cancel: false,
    });
  });

  it("reads addon flags from an older backend as off", () => {
    expect(addonFlagsOf(undefined)).toEqual({
      transcription: false,
      guestCalls: false,
      scheduledCalls: false,
    });
    expect(addonFlagsOf({ transcription: true })).toEqual({
      transcription: true,
      guestCalls: false,
      scheduledCalls: false,
    });
  });
});

describe("transcript summary parsing", () => {
  it("returns plain, bounded text and drops empty entries", () => {
    const summary = parseTranscriptSummary(
      JSON.stringify({
        overview: "  We agreed to ship.  ",
        keyPoints: ["One", "", 7, "Two"],
        decisions: ["Ship Friday"],
        actionItems: [
          { text: "Write docs", owner: "Sam" },
          { text: "", owner: "x" },
          { text: "Test" },
        ],
        speakerHighlights: [
          { speaker: "Sam", text: "Liked it" },
          { speaker: "", text: "x" },
        ],
        language: "en",
      }),
    );
    expect(summary?.overview).toBe("We agreed to ship.");
    expect(summary?.keyPoints).toEqual(["One", "Two"]);
    expect(summary?.actionItems).toEqual([
      { text: "Write docs", owner: "Sam" },
      { text: "Test", owner: null },
    ]);
    expect(summary?.speakerHighlights).toEqual([{ speaker: "Sam", text: "Liked it" }]);
    expect(summary?.language).toBe("en");
  });

  it("keeps markup as inert text and strips control and bidi characters", () => {
    const summary = parseTranscriptSummary(
      JSON.stringify({ overview: "<img src=x onerror=alert(1)>‮\u0007 hi" }),
    );
    expect(summary?.overview).toBe("<img src=x onerror=alert(1)> hi");
  });

  it("returns null for anything unusable", () => {
    expect(parseTranscriptSummary(null)).toBeNull();
    expect(parseTranscriptSummary("")).toBeNull();
    expect(parseTranscriptSummary("not json")).toBeNull();
    expect(parseTranscriptSummary("[1,2]")).toBeNull();
    expect(parseTranscriptSummary("{}")).toBeNull();
    expect(parseTranscriptSummary(JSON.stringify({ overview: "   " }))).toBeNull();
  });
});

describe("transcript turns", () => {
  const line = (seq: number, speakerKey: string, text: string, startMs: number, endMs: number) => ({
    id: `doc-${speakerKey}-${startMs}`,
    seq,
    speakerKey,
    speakerName: speakerKey === "user:a" ? "Ada" : "Visitor",
    text,
    startMs,
    endMs,
  });

  it("merges close lines by the same speaker and splits on speaker or long gaps", () => {
    const turns = groupTranscriptTurns([
      line(1, "user:a", "Hello", 0, 1_000),
      line(2, "user:a", "everyone.", 2_000, 3_000),
      line(3, "guest:g", "Hi!", 3_500, 4_000),
      line(4, "user:a", "Later point.", 30_000, 31_000),
      line(5, "user:a", "  ", 31_500, 32_000),
    ]);
    expect(turns.map((turn) => turn.text)).toEqual(["Hello everyone.", "Hi!", "Later point."]);
    expect(turns[1]?.isGuest).toBe(true);
  });

  it("keeps keys unique when two speakers both start at seq 1", () => {
    const turns = groupTranscriptTurns([
      line(1, "user:a", "First", 0, 1_000),
      line(1, "guest:g", "Second", 2_000, 3_000),
    ]);
    expect(new Set(turns.map((turn) => turn.key)).size).toBe(2);
  });

  it("keys a turn by its first segment's id, so a seq reset after a restart stays unique", () => {
    const turns = groupTranscriptTurns([
      line(1, "user:a", "Before the restart", 0, 1_000),
      // The transcriber restarted: same speaker, seq starts again at 1, much later.
      line(1, "user:a", "After the restart", 60_000, 61_000),
      line(2, "user:a", "and more", 61_500, 62_000),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.key)).toEqual(["doc-user:a-0", "doc-user:a-60000"]);
    expect(new Set(turns.map((turn) => turn.key)).size).toBe(2);
  });

  it("falls back to a generic label when the name snapshot is blank", () => {
    const turns = groupTranscriptTurns([
      {
        id: "d1",
        seq: 1,
        speakerKey: "guest:g",
        speakerName: " ",
        text: "Yo",
        startMs: 0,
        endMs: 1,
      },
    ]);
    expect(turns[0]?.speakerName).toBe("Guest");
  });

  it("formats offsets", () => {
    expect(formatTranscriptTime(7_400)).toBe("0:07");
    expect(formatTranscriptTime(12 * 60_000 + 3_000)).toBe("12:03");
    expect(formatTranscriptTime(3_729_000)).toBe("1:02:09");
    expect(formatTranscriptTime(-5)).toBe("0:00");
  });
});

describe("splitScheduledCalls", () => {
  const now = Date.UTC(2026, 10, 9, 15, 0);
  const base = { durationMinutes: null };
  it("keeps live and future calls upcoming and moves finished ones to past", () => {
    const calls = [
      { id: "future", status: "scheduled" as const, startsAt: now + 3_600_000, ...base },
      { id: "live", status: "open" as const, startsAt: now - 5 * 3_600_000, ...base },
      { id: "missed", status: "scheduled" as const, startsAt: now - 2 * 3_600_000, ...base },
      { id: "ended", status: "ended" as const, startsAt: now - 3_600_000, ...base },
      { id: "cancelled", status: "cancelled" as const, startsAt: now + 3_600_000, ...base },
      {
        id: "in-progress",
        status: "scheduled" as const,
        startsAt: now - 10 * 60_000,
        durationMinutes: 30,
      },
    ];
    const { upcoming, past } = splitScheduledCalls(calls, now);
    expect(upcoming.map((call) => call.id)).toEqual(["future", "live", "in-progress"]);
    expect(past.map((call) => call.id)).toEqual(["missed", "ended", "cancelled"]);
  });

  it("formats a time range in the viewer's zone", () => {
    const start = Date.UTC(2026, 10, 9, 20, 30);
    expect(formatCallTimeRange(start, 30, NY)).toBe("3:30 PM EST – 4:00 PM");
    expect(formatCallTimeRange(start, null, NY)).toBe("3:30 PM EST");
  });
});
