import { expect, it } from "vitest";
import { nativeDarkPalette, nativeLightPalette } from "../src/colors";

function luminance(hex: string): number {
  const values = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
}
function contrast(a: string, b: string): number {
  const [low = 0, high = 0] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}
it("keeps native text and button labels above 4.5:1 in both appearances", () => {
  for (const palette of [nativeDarkPalette, nativeLightPalette]) {
    for (const surface of ["bg", "surface-1", "surface-2", "surface-3"] as const) {
      for (const foreground of ["text", "text-muted", "accent", "secondary", "danger"] as const) {
        expect(
          contrast(palette[foreground], palette[surface]),
          `${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(palette["on-accent"], palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.bg, palette.danger)).toBeGreaterThanOrEqual(4.5);
  }
});
