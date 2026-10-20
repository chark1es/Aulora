/**
 * The palette offered when a person picks a colour for a kanban label or a note
 * tag. Declared once so both surfaces stay in step; the hex values are fixed
 * swatches rather than theme tokens, so they read the same in light and dark.
 */
export const LABEL_COLOR_SWATCHES = [
  "#E5484D",
  "#E4571C",
  "#E8A33B",
  "#46A758",
  "#12A594",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#8B8D98",
] as const;

/** The colour a new label or tag falls back to when none is chosen. */
export const DEFAULT_LABEL_COLOR = "#E4571C";

/** The swatch at `index`, wrapping around; negatives and gaps fall back. */
export function labelSwatchAt(index: number): string {
  if (!Number.isInteger(index) || index < 0) return DEFAULT_LABEL_COLOR;
  return LABEL_COLOR_SWATCHES[index % LABEL_COLOR_SWATCHES.length] ?? DEFAULT_LABEL_COLOR;
}
