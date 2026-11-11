import {
  hslToHex,
  parseHexColor,
  ROLE_COLOR_PRESETS,
  type RoleColorPreviewSurface,
  rgbToHsl,
  roleColorChecks,
  roleColorHeadline,
  roleColorRepairs,
} from "@aulora/core";
import { paletteFor } from "@aulora/tokens";
import { describe, expect, it } from "vitest";

// The surfaces RoleColorPreview (web and native) actually paints on.
const SURFACES: readonly RoleColorPreviewSurface[] = [
  { theme: "light", background: paletteFor("light").chat },
  { theme: "dark", background: paletteFor("dark").chat },
];

const SWEEP = Array.from({ length: 24 * 5 * 21 }, (_, i) =>
  hslToHex(Math.floor(i / 105) * 15, (Math.floor(i / 21) % 5) / 4, (i % 21) / 20),
);

const passes = (color: string) =>
  roleColorChecks(color, SURFACES).map((check) => check.ratio >= 4.5);

describe("role color previews on the real chat surfaces", () => {
  it("uses the palette chat backgrounds the core tests mirror", () => {
    expect(SURFACES.map((surface) => surface.background)).toEqual(["#FFFFFF", "#1C1C1E"]);
  });

  it("no colour reaches 4.5:1 on both themes, so there is no 'readable on both' state", () => {
    for (const color of [...SWEEP, ...ROLE_COLOR_PRESETS]) {
      const [light, dark] = passes(color);
      expect(light === true && dark === true, color).toBe(false);
    }
    // Analytic bound: passing light needs luminance <= 0.183, passing dark needs >= 0.227.
    const best = Math.max(
      ...SWEEP.map((color) => Math.min(...roleColorChecks(color, SURFACES).map((c) => c.ratio))),
    );
    expect(best).toBeLessThan(4.5);
  });

  it("explains a refused repair when exactly one theme passes", () => {
    let blocked = 0;
    // A stride keeps the run quick; every sampled one-theme-passes colour must be explained.
    for (const color of [
      ...SWEEP.filter((_, i) => i % 13 === 0),
      ...ROLE_COLOR_PRESETS,
      "#C2410C",
    ]) {
      const [light, dark] = passes(color);
      if (light === dark) continue;
      const failing = light === true ? "dark" : "light";
      const passing = light === true ? "light" : "dark";
      const repair = roleColorRepairs(color, SURFACES).find((entry) => entry.theme === failing);
      if (repair === undefined) continue; // no shade fixes the failing theme even alone
      expect(repair.suggestion, color).toBeNull();
      expect(repair.blockedBy, color).toBe(passing);
      blocked += 1;
    }
    expect(blocked).toBeGreaterThan(10);
  }, 30_000);

  it("covers the reported #C2410C case", () => {
    const checks = roleColorChecks("#C2410C", SURFACES);
    expect(checks.map((check) => check.ratioLabel)).toEqual(["5.1:1", "3.2:1"]);
    expect(roleColorHeadline(checks)).toBe("Passes AA on light only");
    expect(roleColorRepairs("#C2410C", SURFACES)).toEqual([
      { theme: "dark", suggestion: null, blockedBy: "light" },
    ]);
  });

  it("offers a hue-preserving repair per theme when both fail, and never one that hurts a pass", () => {
    let both = 0;
    for (const color of SWEEP.filter((_, i) => i % 9 === 0)) {
      const before = roleColorChecks(color, SURFACES);
      const rgb = parseHexColor(color);
      if (rgb === null) continue;
      for (const repair of roleColorRepairs(color, SURFACES)) {
        if (repair.suggestion === null) continue;
        // A suggestion exists only while no theme passes, so nothing can regress.
        expect(
          before.every((check) => check.ratio < 4.5),
          color,
        ).toBe(true);
        both += 1;
        const index = repair.theme === "light" ? 0 : 1;
        expect(repair.suggestion.checks[index]?.ratio).toBeGreaterThanOrEqual(4.5);
        expect(repair.suggestion.checks.map((check) => check.theme)).toEqual(["light", "dark"]);
        expect(
          roleColorChecks(repair.suggestion.color, SURFACES)[index]?.ratio,
        ).toBeGreaterThanOrEqual(4.5);
        const next = parseHexColor(repair.suggestion.color);
        if (next !== null && rgbToHsl(rgb).s > 0.2 && rgbToHsl(next).s > 0.2) {
          const hueDelta = Math.abs(rgbToHsl(rgb).h - rgbToHsl(next).h);
          expect(Math.min(hueDelta, 360 - hueDelta)).toBeLessThan(8);
        }
      }
    }
    expect(both).toBeGreaterThan(10);
  }, 30_000);
});
