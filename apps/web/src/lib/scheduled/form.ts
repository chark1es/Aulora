import {
  fromDateTimeLocalValue,
  type LocalTimeOptions,
  SCHEDULED_CALL_DESCRIPTION_MAX,
  SCHEDULED_CALL_MAX_DURATION_MINUTES,
  SCHEDULED_CALL_MAX_HORIZON_MS,
  SCHEDULED_CALL_MAX_OPEN_LEAD_MINUTES,
  SCHEDULED_CALL_MIN_DURATION_MINUTES,
  SCHEDULED_CALL_START_TOLERANCE_MS,
  SCHEDULED_CALL_TITLE_MAX,
} from "@aulora/core";

export type ScheduleTarget = "channel" | "standalone";

/** What the create/edit dialog holds while it is open. */
export interface ScheduleDraft {
  readonly title: string;
  readonly description: string;
  /** `YYYY-MM-DDTHH:mm`, wall time in the viewer's zone. */
  readonly startLocal: string;
  /** Minutes, or the empty string for "no set length". */
  readonly durationMinutes: string;
  readonly openLeadMinutes: number;
  readonly target: ScheduleTarget;
  readonly channelId: string;
  readonly inviteeUserIds: readonly string[];
  readonly inviteeRoleIds: readonly string[];
}

export type DraftErrors = Partial<
  Record<"title" | "description" | "start" | "duration" | "channel" | "invitees", string>
>;

export interface ValidDraft {
  readonly title: string;
  readonly description: string;
  readonly startsAt: number;
  readonly durationMinutes: number | null;
  readonly openLeadMinutes: number;
}

/** The "opens before the start" choices, in minutes. */
export const OPEN_LEAD_CHOICES: readonly number[] = [0, 1, 2, 5, 10, 15, 30, 60, 120];

/** The "how long" choices, in minutes; the empty string means no set length. */
export const DURATION_CHOICES: readonly number[] = [15, 30, 45, 60, 90, 120];

/**
 * Checks a draft the way the server will: lengths, a start that is in the
 * future (within the server's tolerance) and inside the next year, a sensible
 * duration, and at least one invitee for a room with no channel. The server
 * re-checks all of it; this only saves a round trip and words the problem.
 */
export function validateDraft(
  draft: ScheduleDraft,
  now: number,
  options?: LocalTimeOptions,
  editing = false,
): { readonly errors: DraftErrors; readonly value: ValidDraft | null } {
  const errors: { -readonly [K in keyof DraftErrors]: string } = {};
  const title = draft.title.trim();
  if (title.length === 0) {
    errors.title = "Give the call a title.";
  } else if (title.length > SCHEDULED_CALL_TITLE_MAX) {
    errors.title = `Keep the title under ${SCHEDULED_CALL_TITLE_MAX} characters.`;
  }
  const description = draft.description.trim();
  if (description.length > SCHEDULED_CALL_DESCRIPTION_MAX) {
    errors.description = `Keep the description under ${SCHEDULED_CALL_DESCRIPTION_MAX} characters.`;
  }
  const startsAt = fromDateTimeLocalValue(draft.startLocal, options);
  if (startsAt === null) {
    errors.start = "Choose a date and time.";
  } else if (startsAt < now + SCHEDULED_CALL_START_TOLERANCE_MS) {
    errors.start = "Choose a start time in the future.";
  } else if (startsAt > now + SCHEDULED_CALL_MAX_HORIZON_MS) {
    errors.start = "Choose a start time within the next year.";
  }
  let durationMinutes: number | null = null;
  if (draft.durationMinutes.trim().length > 0) {
    const parsed = Number(draft.durationMinutes);
    if (
      !Number.isInteger(parsed) ||
      parsed < SCHEDULED_CALL_MIN_DURATION_MINUTES ||
      parsed > SCHEDULED_CALL_MAX_DURATION_MINUTES
    ) {
      errors.duration = `Choose a length from ${SCHEDULED_CALL_MIN_DURATION_MINUTES} to ${SCHEDULED_CALL_MAX_DURATION_MINUTES} minutes.`;
    } else {
      durationMinutes = parsed;
    }
  }
  if (!editing) {
    if (draft.target === "channel" && draft.channelId.length === 0) {
      errors.channel = "Choose where the call happens.";
    }
  }
  if (
    draft.target === "standalone" &&
    draft.inviteeUserIds.length === 0 &&
    draft.inviteeRoleIds.length === 0
  ) {
    errors.invitees = "Invite at least one person or role.";
  }
  const openLeadMinutes = Math.min(
    SCHEDULED_CALL_MAX_OPEN_LEAD_MINUTES,
    Math.max(0, Math.trunc(draft.openLeadMinutes)),
  );
  if (Object.keys(errors).length > 0 || startsAt === null) {
    return { errors, value: null };
  }
  return {
    errors,
    value: { title, description, startsAt, durationMinutes, openLeadMinutes },
  };
}

/** Adds or removes `id`, keeping the rest in order. */
export function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

const GUEST_LINK_FLOOR_MS = 60_000;
const GUEST_LINK_CEILING_MS = 7 * 24 * 3_600_000;
const GRACE_MS = 10 * 60_000;

/**
 * How long a guest link for a call that has not started should live: until a
 * short grace after the call is due to end, clamped to the server's 1 minute to
 * 7 day range. The server also caps it at the call's end, so this only asks for
 * a lifetime that makes sense rather than the one-hour default.
 */
export function scheduledGuestLinkTtlMs(
  startsAt: number,
  durationMinutes: number | null,
  now: number,
): number {
  const end = startsAt + (durationMinutes ?? 60) * 60_000 + GRACE_MS;
  return Math.min(GUEST_LINK_CEILING_MS, Math.max(GUEST_LINK_FLOOR_MS, end - now));
}
