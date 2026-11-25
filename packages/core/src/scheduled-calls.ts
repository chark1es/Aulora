/**
 * Shared constants, time helpers and the typed "not open yet" error for the
 * optional scheduled-calls addon.
 *
 * All times are UTC epoch milliseconds. Clients render them in the viewer's
 * local time zone; the server never stores local time.
 */

export const SCHEDULED_CALL_STATUSES = ["scheduled", "open", "ended", "cancelled"] as const;
export type ScheduledCallStatus = (typeof SCHEDULED_CALL_STATUSES)[number];

/** Default and supported "opens before start" window, in minutes. */
export const SCHEDULED_CALL_DEFAULT_OPEN_LEAD_MINUTES = 5;
export const SCHEDULED_CALL_MAX_OPEN_LEAD_MINUTES = 120;

/** Title/description limits (server-enforced; clients pre-check). */
export const SCHEDULED_CALL_TITLE_MAX = 120;
export const SCHEDULED_CALL_DESCRIPTION_MAX = 2_000;

export const SCHEDULED_CALL_MIN_DURATION_MINUTES = 5;
export const SCHEDULED_CALL_MAX_DURATION_MINUTES = 24 * 60;

/** A start time must be in the future by at least this tolerance and within a year. */
export const SCHEDULED_CALL_START_TOLERANCE_MS = 60_000;
export const SCHEDULED_CALL_MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

/** Caps on scheduled calls. */
export const SCHEDULED_CALL_MAX_UPCOMING_WORKSPACE = 200;
export const SCHEDULED_CALL_MAX_UPCOMING_CREATOR = 50;

/** Bounded read window for the list query. */
export const SCHEDULED_CALL_LIST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const SCHEDULED_CALL_LIST_LIMIT = 100;

/** Error code carried in the structured `ScheduledCallNotOpen` ConvexError. */
export const SCHEDULED_CALL_NOT_OPEN = "ScheduledCallNotOpen";

export interface ScheduledCallNotOpenError {
  readonly code: typeof SCHEDULED_CALL_NOT_OPEN;
  readonly message: string;
  readonly startsAt: number;
  readonly opensAt: number;
  /** Convex values require an index signature on a structured error payload. */
  readonly [key: string]: string | number;
}

/** Server-clock time at which a scheduled call accepts joins. */
export function scheduledCallOpensAt(startsAt: number, openLeadMinutes: number): number {
  return startsAt - Math.max(0, openLeadMinutes) * 60_000;
}

/** The structured error payload for a join that is too early. */
export function scheduledCallNotOpen(
  startsAt: number,
  openLeadMinutes: number,
): ScheduledCallNotOpenError {
  const opensAt = scheduledCallOpensAt(startsAt, openLeadMinutes);
  return {
    code: SCHEDULED_CALL_NOT_OPEN,
    message: "This call hasn't started yet",
    startsAt,
    opensAt,
  };
}

/** Clamps an open-lead value to the supported range. */
export function clampOpenLeadMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return SCHEDULED_CALL_DEFAULT_OPEN_LEAD_MINUTES;
  }
  return Math.min(SCHEDULED_CALL_MAX_OPEN_LEAD_MINUTES, Math.max(0, Math.trunc(value)));
}

/** A call without a set length is treated as ending this long after it starts. */
export const SCHEDULED_CALL_DEFAULT_WINDOW_MINUTES = 240;

/** Server-clock time at which a scheduled call's window ends. */
export function scheduledCallEndsAt(startsAt: number, durationMinutes: number | undefined): number {
  return startsAt + (durationMinutes ?? SCHEDULED_CALL_DEFAULT_WINDOW_MINUTES) * 60_000;
}

/** Member waiting room for a scheduled call. */
export type ScheduledWaitingKind = "early" | "knock";
export type ScheduledWaitingStatus = "waiting" | "admitted" | "declined";

/** Members that may wait for one call at once. */
export const SCHEDULED_WAITING_MAX_PENDING = 25;
/** Admitted rows kept per call, so a rejoin after a disconnect keeps working. */
export const SCHEDULED_WAITING_MAX_ADMITTED = 100;
/** How long an unanswered knock stays in the waiting room. */
export const SCHEDULED_WAITING_KNOCK_TTL_MS = 10 * 60_000;
/** Longest an early arrival waits before they have to ask again. */
export const SCHEDULED_WAITING_EARLY_MAX_MS = 12 * 60 * 60_000;
/** After a decline the member cannot ask again for this long. */
export const SCHEDULED_WAITING_DECLINE_COOLDOWN_MS = 60_000;
/** Rows outlive the call window by this much before the sweep prunes them. */
export const SCHEDULED_WAITING_GRACE_MS = 10 * 60_000;
