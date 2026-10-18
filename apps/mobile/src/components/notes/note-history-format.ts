/**
 * Time formatting for the mobile note history list: a compact span between
 * two instants, matching the web client's wording. The collapse itself is a
 * pure string function so it can be tested without a locale or clock.
 */

const PERIOD = /([AP]M)$/i;

/** "2:10–2:24 PM" when both times share a period, else two full times. */
export function collapseTimeRange(start: string, end: string): string {
  const startPeriod = PERIOD.exec(start)?.[1];
  const endPeriod = PERIOD.exec(end)?.[1];
  if (startPeriod !== undefined && startPeriod === endPeriod) {
    return `${start.slice(0, -startPeriod.length).trimEnd()}–${end}`;
  }
  return `${start}–${end}`;
}

function formatClockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
