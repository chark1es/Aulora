/**
 * Formatting helpers for the note history list, kept out of the component so
 * the render functions stay small. Times are locale-formatted like
 * `types.ts`'s `formatTimestamp`, so the two read consistently.
 */

/** "2:10 PM" in the viewer's locale. */
export function formatClockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const PERIOD = /([AP]M)$/i;

/**
 * A compact span between two instants on the same day: "2:10–2:24 PM". Falls
 * back to two full times when the period differs (e.g. across noon).
 */
export function formatTimeRange(from: number, to: number): string {
  const start = formatClockTime(from);
  const end = formatClockTime(to);
  const startPeriod = PERIOD.exec(start)?.[1];
  const endPeriod = PERIOD.exec(end)?.[1];
  if (startPeriod !== undefined && startPeriod === endPeriod) {
    return `${start.slice(0, -startPeriod.length).trimEnd()}–${end}`;
  }
  return `${start}–${end}`;
}

/** A group's time span, date-prefixed when it did not happen today. */
export function formatGroupTime(from: number, to: number, now: number): string {
  const range = formatTimeRange(from, to);
  if (new Date(from).toDateString() === new Date(now).toDateString()) return range;
  const day = new Date(from).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} · ${range}`;
}

/** A stable element id from an arbitrary revision id, for `aria-controls`. */
export function domId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
