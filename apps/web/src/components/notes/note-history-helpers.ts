/**
 * Formatting helpers for the note history list, kept out of the component so
 * the render functions stay small. The time formatting is shared with mobile in
 * `@aulora/core`; `domId` is the one web-only piece.
 */

export {
  collapseTimeRange,
  formatClockTime,
  formatGroupTime,
  formatTimeRange,
} from "@aulora/core";

/** A stable element id from an arbitrary revision id, for `aria-controls`. */
export function domId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
