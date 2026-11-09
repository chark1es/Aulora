/**
 * Presentation helpers for scheduled calls: local-time formatting with the zone
 * name, day grouping, the join-window state, DST-safe conversion between a
 * local date-time field and UTC, and parsing of the structured
 * `ScheduledCallNotOpen` error.
 *
 * Everything is stored and compared in UTC epoch milliseconds. Local time exists
 * only at the edges, in the viewer's zone (`Intl.DateTimeFormat`), and the
 * server's refusal to join early is the authority; the countdown is cosmetic.
 */

import {
  SCHEDULED_CALL_NOT_OPEN,
  type ScheduledCallStatus,
  scheduledCallOpensAt,
} from "./scheduled-calls";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The viewer's IANA zone, or `UTC` when the runtime cannot say. */
export function viewerTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface LocalTimeOptions {
  /** IANA zone; defaults to the viewer's. */
  readonly timeZone?: string;
  /** BCP 47 locale; defaults to the runtime's. */
  readonly locale?: string | undefined;
}

function zoneOf(options: LocalTimeOptions | undefined): string {
  return options?.timeZone ?? viewerTimeZone();
}

function formatter(
  options: LocalTimeOptions | undefined,
  format: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(options?.locale, { ...format, timeZone: zoneOf(options) });
}

/** "3:30 PM" in the viewer's zone. */
export function formatLocalTime(ms: number, options?: LocalTimeOptions): string {
  return formatter(options, { hour: "numeric", minute: "2-digit" }).format(ms);
}

/** The short zone name at that instant, e.g. "PST", "GMT+1". DST-aware. */
export function formatZoneName(ms: number, options?: LocalTimeOptions): string {
  const parts = formatter(options, { timeZoneName: "short" }).formatToParts(ms);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? zoneOf(options);
}

/** "3:30 PM PST": the time with its zone name. */
export function formatLocalTimeWithZone(ms: number, options?: LocalTimeOptions): string {
  return `${formatLocalTime(ms, options)} ${formatZoneName(ms, options)}`;
}

/** "Tue, Nov 9" for a day heading. */
export function formatLocalDay(ms: number, options?: LocalTimeOptions): string {
  return formatter(options, { weekday: "short", month: "short", day: "numeric" }).format(ms);
}

/** "Tue, Nov 9, 3:30 PM PST", including the year when it is not this one. */
export function formatLocalDateTime(
  ms: number,
  now: number = Date.now(),
  options?: LocalTimeOptions,
): string {
  const sameYear = localDateParts(ms, options).year === localDateParts(now, options).year;
  const date = formatter(options, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(ms);
  return `${date}, ${formatLocalTimeWithZone(ms, options)}`;
}

export interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** The wall-clock fields of an instant in a zone. */
export function localDateParts(ms: number, options?: LocalTimeOptions): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneOf(options),
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(ms);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour") % 24,
    minute: pick("minute"),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** A stable `YYYY-MM-DD` key for the local calendar day of an instant. */
export function localDayKey(ms: number, options?: LocalTimeOptions): string {
  const { year, month, day } = localDateParts(ms, options);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The value for an `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm`. */
export function toDateTimeLocalValue(ms: number, options?: LocalTimeOptions): string {
  const { year, month, day, hour, minute } = localDateParts(ms, options);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

/**
 * Converts the wall-clock value of a `datetime-local` field in `timeZone` to a
 * UTC instant, or `null` when it is not a real calendar value. Across a DST
 * change a skipped local time resolves to the first instant after the gap and an
 * ambiguous one to its first occurrence, so the result always round-trips to a
 * valid wall time.
 */
export function fromDateTimeLocalValue(value: string, options?: LocalTimeOptions): number | null {
  const match = DATE_TIME_LOCAL.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const zoneOptions: LocalTimeOptions = { timeZone: zoneOf(options) };
  const offsetAt = (instant: number): number => {
    const parts = localDateParts(instant, zoneOptions);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant;
  };
  // The offset at the guess may sit on the wrong side of a DST change, so settle
  // it with a second pass from the first correction.
  const first = wall - offsetAt(wall);
  const second = wall - offsetAt(first);
  const candidates = first === second ? [first] : [first, second];
  const exact = candidates.filter((instant) => {
    const parts = localDateParts(instant, zoneOptions);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) === wall;
  });
  if (exact.length > 0) {
    // Ambiguous fall-back hour: take the earlier of the two valid instants.
    return Math.min(...exact);
  }
  // A skipped spring-forward time: land on the first instant after the gap.
  return Math.max(...candidates);
}

/** The `YYYY-MM-DD` key `days` calendar days after `key`. */
function shiftDayKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export interface DayGroup<T> {
  /** `YYYY-MM-DD` in the viewer's zone. */
  readonly key: string;
  /** "Today", "Tomorrow", "Yesterday" or a short date. */
  readonly label: string;
  readonly items: readonly T[];
}

/**
 * Groups items by the local calendar day of `startOf(item)`, in `order`
 * (ascending for upcoming, descending for past). Days are keyed in the viewer's
 * zone, so a late-evening call never lands on the wrong day.
 */
export function groupByLocalDay<T>(
  items: readonly T[],
  startOf: (item: T) => number,
  now: number,
  order: "asc" | "desc",
  options?: LocalTimeOptions,
): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) =>
    order === "asc" ? startOf(a) - startOf(b) : startOf(b) - startOf(a),
  );
  // Neighbouring days come from calendar arithmetic, not +/-24 h, which is wrong
  // on the 23 and 25 hour days around a DST change.
  const todayKey = localDayKey(now, options);
  const tomorrowKey = shiftDayKey(todayKey, 1);
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of sorted) {
    const start = startOf(item);
    const key = localDayKey(start, options);
    const last = groups.at(-1);
    if (last !== undefined && last.key === key) {
      last.items.push(item);
      continue;
    }
    const label =
      key === todayKey
        ? "Today"
        : key === tomorrowKey
          ? "Tomorrow"
          : key === yesterdayKey
            ? "Yesterday"
            : formatLocalDay(start, options);
    groups.push({ key, label, items: [item] });
  }
  return groups;
}

export type ScheduledJoinState =
  | { readonly kind: "cancelled" }
  | { readonly kind: "ended" }
  | { readonly kind: "not-open"; readonly opensAt: number; readonly opensInMs: number }
  | { readonly kind: "open" };

/**
 * Where a scheduled call stands for the join button. `not-open` is a cosmetic
 * hint from the viewer's clock; the server refuses an early join regardless.
 */
export function scheduledJoinState(
  call: {
    readonly status: ScheduledCallStatus;
    readonly startsAt: number;
    readonly openLeadMinutes: number;
    readonly canJoin?: boolean;
  },
  now: number,
): ScheduledJoinState {
  if (call.status === "cancelled") {
    return { kind: "cancelled" };
  }
  if (call.status === "ended" || call.canJoin === false) {
    return { kind: "ended" };
  }
  const opensAt = scheduledCallOpensAt(call.startsAt, call.openLeadMinutes);
  if (call.status === "open") {
    return { kind: "open" };
  }
  if (now < opensAt) {
    return { kind: "not-open", opensAt, opensInMs: opensAt - now };
  }
  return { kind: "open" };
}

/** "in 2 days", "in 3 h 5 min", "in 4 min", "in under a minute". */
export function formatOpensIn(ms: number): string {
  if (ms < MINUTE_MS) {
    return "in under a minute";
  }
  const days = Math.floor(ms / DAY_MS);
  if (days >= 2) {
    return `in ${days} days`;
  }
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (hours >= 1) {
    return minutes === 0 ? `in ${hours} h` : `in ${hours} h ${minutes} min`;
  }
  return `in ${minutes} min`;
}

/**
 * The next instant the countdown text changes, so a ticking label can sleep
 * instead of re-rendering every second. Never below 1 second nor above 1 minute.
 */
export function nextCountdownTickMs(opensInMs: number): number {
  if (opensInMs <= MINUTE_MS) {
    return 1_000;
  }
  return Math.min(MINUTE_MS, Math.max(1_000, opensInMs % MINUTE_MS || MINUTE_MS));
}

export interface ScheduledCallNotOpenInfo {
  readonly startsAt: number;
  readonly opensAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the structured `ScheduledCallNotOpen` payload from a thrown Convex
 * error (`error.data`), accepting the payload as an object or a JSON string.
 * Returns `null` for any other error so callers fall back to its message.
 */
export function parseScheduledCallNotOpen(error: unknown): ScheduledCallNotOpenInfo | null {
  if (!isRecord(error)) {
    return null;
  }
  let data: unknown = error.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || data.code !== SCHEDULED_CALL_NOT_OPEN) {
    return null;
  }
  const { startsAt, opensAt } = data;
  if (
    typeof startsAt !== "number" ||
    typeof opensAt !== "number" ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(opensAt)
  ) {
    return null;
  }
  return { startsAt, opensAt };
}

/** "This call hasn't started yet — opens at 3:25 PM PST". */
export function notOpenMessage(info: ScheduledCallNotOpenInfo, options?: LocalTimeOptions): string {
  return `This call hasn't started yet — opens at ${formatLocalTimeWithZone(info.opensAt, options)}`;
}

/** How long a scheduled call without a set length still counts as "now". */
const DEFAULT_CALL_LENGTH_MINUTES = 60;

/**
 * Splits the list into what is still ahead (or live) and what is over. A
 * `scheduled` call whose end has passed without anyone opening it is past, as is
 * anything ended or cancelled; an `open` call stays upcoming while it is live.
 */
export function splitScheduledCalls<
  T extends {
    readonly status: ScheduledCallStatus;
    readonly startsAt: number;
    readonly durationMinutes: number | null;
  },
>(calls: readonly T[], now: number): { readonly upcoming: T[]; readonly past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const call of calls) {
    const end = call.startsAt + (call.durationMinutes ?? DEFAULT_CALL_LENGTH_MINUTES) * MINUTE_MS;
    const over =
      call.status === "ended" ||
      call.status === "cancelled" ||
      (call.status === "scheduled" && end <= now);
    (over ? past : upcoming).push(call);
  }
  return { upcoming, past };
}

/** "3:30 PM EST – 4:00 PM" for a call with a length, else just the start. */
export function formatCallTimeRange(
  startsAt: number,
  durationMinutes: number | null,
  options?: LocalTimeOptions,
): string {
  if (durationMinutes === null) {
    return formatLocalTimeWithZone(startsAt, options);
  }
  const end = startsAt + durationMinutes * MINUTE_MS;
  return `${formatLocalTimeWithZone(startsAt, options)} – ${formatLocalTime(end, options)}`;
}
