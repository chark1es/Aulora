/**
 * Relative "time ago" labels shared by the web and mobile clients.
 *
 * The bucketing is identical everywhere; only the absolute fallback for
 * anything older than a week can differ. Mobile passes a hand-built formatter
 * so long lists never pay for `Intl` date formatting.
 */

import type { Fn } from "./function-type";

export interface RelativeTimeOptions {
  /**
   * Formats the absolute date for an item older than a week. Defaults to the
   * viewer's locale as a short month and day (e.g. `Nov 3`).
   */
  readonly formatAbsolute?: Fn<[at: number, now: number], string>;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** A relative "time ago" label such as `just now`, `12m ago` or `Nov 3`. */
export function timeAgo(at: number, now: number, options: RelativeTimeOptions = {}): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return (
    options.formatAbsolute?.(at, now) ??
    new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  );
}
