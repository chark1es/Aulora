import { describe, expect, it } from "vitest";
import { type ScheduleDraft, scheduledGuestLinkTtlMs, toggleId, validateDraft } from "./form";

const NY = { timeZone: "America/New_York", locale: "en-US" } as const;
const NOW = Date.UTC(2026, 10, 9, 15, 0);

const draft: ScheduleDraft = {
  title: "  Weekly sync ",
  description: "",
  startLocal: "2026-11-10T10:00",
  durationMinutes: "30",
  openLeadMinutes: 5,
  target: "channel",
  channelId: "ch1",
  inviteeUserIds: [],
  inviteeRoleIds: [],
};

describe("validateDraft", () => {
  it("returns a trimmed value with the start converted to UTC from the viewer's zone", () => {
    const { errors, value } = validateDraft(draft, NOW, NY);
    expect(errors).toEqual({});
    expect(value).toEqual({
      title: "Weekly sync",
      description: "",
      startsAt: Date.UTC(2026, 10, 10, 15, 0),
      durationMinutes: 30,
      openLeadMinutes: 5,
    });
  });

  it("rejects a missing title and an over-long title or description", () => {
    expect(validateDraft({ ...draft, title: "  " }, NOW, NY).errors.title).toBeDefined();
    expect(validateDraft({ ...draft, title: "x".repeat(121) }, NOW, NY).errors.title).toBeDefined();
    expect(
      validateDraft({ ...draft, description: "x".repeat(2001) }, NOW, NY).errors.description,
    ).toBeDefined();
  });

  it("enforces the future tolerance and the one-year horizon", () => {
    // 09:59 New York is in the past relative to NOW (10:00 local).
    expect(validateDraft({ ...draft, startLocal: "2026-11-09T09:59" }, NOW, NY).errors.start).toBe(
      "Choose a start time in the future.",
    );
    // Inside the 60 s tolerance counts as not future enough.
    expect(validateDraft({ ...draft, startLocal: "2026-11-09T10:00" }, NOW, NY).errors.start).toBe(
      "Choose a start time in the future.",
    );
    expect(validateDraft({ ...draft, startLocal: "2026-11-09T10:02" }, NOW, NY).errors.start).toBe(
      undefined,
    );
    expect(validateDraft({ ...draft, startLocal: "2027-12-10T10:00" }, NOW, NY).errors.start).toBe(
      "Choose a start time within the next year.",
    );
    expect(validateDraft({ ...draft, startLocal: "" }, NOW, NY).errors.start).toBe(
      "Choose a date and time.",
    );
  });

  it("accepts no set length and rejects an out-of-range one", () => {
    expect(validateDraft({ ...draft, durationMinutes: "" }, NOW, NY).value?.durationMinutes).toBe(
      null,
    );
    expect(
      validateDraft({ ...draft, durationMinutes: "4" }, NOW, NY).errors.duration,
    ).toBeDefined();
    expect(
      validateDraft({ ...draft, durationMinutes: "1441" }, NOW, NY).errors.duration,
    ).toBeDefined();
    expect(
      validateDraft({ ...draft, durationMinutes: "2.5" }, NOW, NY).errors.duration,
    ).toBeDefined();
  });

  it("needs a channel for a channel call and an invitee for a standalone room", () => {
    expect(validateDraft({ ...draft, channelId: "" }, NOW, NY).errors.channel).toBeDefined();
    const standalone = { ...draft, target: "standalone" as const, channelId: "" };
    expect(validateDraft(standalone, NOW, NY).errors.invitees).toBeDefined();
    expect(
      validateDraft({ ...standalone, inviteeRoleIds: ["r1"] }, NOW, NY).errors.invitees,
    ).toBeUndefined();
    // Editing never re-asks for the channel, which cannot change.
    expect(
      validateDraft({ ...draft, channelId: "" }, NOW, NY, true).errors.channel,
    ).toBeUndefined();
  });

  it("clamps the open lead to the supported range", () => {
    expect(validateDraft({ ...draft, openLeadMinutes: 500 }, NOW, NY).value?.openLeadMinutes).toBe(
      120,
    );
    expect(validateDraft({ ...draft, openLeadMinutes: -3 }, NOW, NY).value?.openLeadMinutes).toBe(
      0,
    );
  });
});

describe("toggleId", () => {
  it("adds and removes ids without disturbing order", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("scheduledGuestLinkTtlMs", () => {
  it("lives until shortly after the call is due to end", () => {
    const startsAt = NOW + 3_600_000;
    expect(scheduledGuestLinkTtlMs(startsAt, 30, NOW)).toBe(3_600_000 + 30 * 60_000 + 600_000);
    expect(scheduledGuestLinkTtlMs(startsAt, null, NOW)).toBe(3_600_000 + 3_600_000 + 600_000);
  });

  it("stays inside the server's range", () => {
    expect(scheduledGuestLinkTtlMs(NOW + 30 * 86_400_000, 30, NOW)).toBe(7 * 86_400_000);
    expect(scheduledGuestLinkTtlMs(NOW - 86_400_000, 30, NOW)).toBe(60_000);
  });
});
