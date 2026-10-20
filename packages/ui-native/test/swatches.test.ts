import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_COLOR, LABEL_COLOR_SWATCHES, labelSwatchAt } from "../src/swatches";

describe("labelSwatchAt", () => {
  it("wraps the fixed swatch list", () => {
    expect(labelSwatchAt(0)).toBe(LABEL_COLOR_SWATCHES[0]);
    expect(labelSwatchAt(LABEL_COLOR_SWATCHES.length)).toBe(LABEL_COLOR_SWATCHES[0]);
    expect(labelSwatchAt(LABEL_COLOR_SWATCHES.length + 2)).toBe(LABEL_COLOR_SWATCHES[2]);
  });

  it("falls back to the default for gaps and negatives", () => {
    expect(labelSwatchAt(-1)).toBe(DEFAULT_LABEL_COLOR);
    expect(labelSwatchAt(1.5)).toBe(DEFAULT_LABEL_COLOR);
    expect(labelSwatchAt(Number.NaN)).toBe(DEFAULT_LABEL_COLOR);
  });

  it("offers nine distinct swatches", () => {
    expect(LABEL_COLOR_SWATCHES).toHaveLength(9);
    expect(new Set(LABEL_COLOR_SWATCHES).size).toBe(9);
  });
});
