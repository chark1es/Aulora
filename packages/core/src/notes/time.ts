/**
 * Time formatting for the note history list.
 *
 * Pure string/date helpers so web and mobile render the same wording, and so
 * the collapse itself can be tested without a locale or a clock.
 */

/** "2:10 PM" in the viewer's locale. */
export function formatClockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const PERIOD = /([AP]M)$/i;

/**
 * A compact span between two clock strings: "2:10–2:24 PM". Falls back to two
 * full times when the period differs (e.g. across noon) or the locale omits it.
 */
export function collapseTimeRange(start: string, end: string): string {
  const startPeriod = PERIOD.exec(start)?.[1];
  const endPeriod = PERIOD.exec(end)?.[1];
  if (startPeriod !== undefined && startPeriod === endPeriod) {
    return `${start.slice(0, -startPeriod.length).trimEnd()}–${end}`;
  }
  return `${start}–${end}`;
}

/** "2:10–2:24 PM", or two full times across a period boundary. */
export function formatTimeRange(from: number, to: number): string {
  return collapseTimeRange(formatClockTime(from), formatClockTime(to));
}

/** A group's span, day-prefixed when it did not happen today. */
export function formatGroupTime(from: number, to: number, now: number): string {
  const range = formatTimeRange(from, to);
  if (new Date(from).toDateString() === new Date(now).toDateString()) return range;
  const day = new Date(from).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} · ${range}`;
}
