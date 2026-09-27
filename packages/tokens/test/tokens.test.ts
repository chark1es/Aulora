import {
  COLOR_TOKENS,
  colors,
  cssVariables,
  darkPalette,
  ICON_NAMES,
  iconPaths,
  lightPalette,
  nativewindPreset,
  radii,
  spacing,
  tailwindPreset,
  theme,
  tokens,
} from "@aulora/tokens";
import { describe, expect, it } from "vitest";

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

describe("color tokens", () => {
  it("documents exactly the plan.md token set", () => {
    expect([...COLOR_TOKENS]).toEqual([
      "bg",
      "grid-dot",
      "surface-1",
      "surface-2",
      "surface-3",
      "border",
      "text",
      "text-muted",
      "accent",
      "accent-soft",
      "on-accent",
      "secondary",
      "danger",
      "rail",
      "rail-text",
      "chat",
    ]);
  });

  it("defines every documented token in both themes", () => {
    for (const token of COLOR_TOKENS) {
      expect(darkPalette[token], `dark:${token}`).toBeTruthy();
      expect(lightPalette[token], `light:${token}`).toBeTruthy();
    }
    expect(Object.keys(darkPalette).sort()).toEqual([...COLOR_TOKENS].sort());
    expect(Object.keys(lightPalette).sort()).toEqual([...COLOR_TOKENS].sort());
  });

  it("stores every color as a hex string", () => {
    for (const token of COLOR_TOKENS) {
      expect(darkPalette[token]).toMatch(HEX);
      expect(lightPalette[token]).toMatch(HEX);
    }
  });

  it("matches the exact Loam and Linen values", () => {
    expect(darkPalette).toMatchObject({
      bg: "#1C1C1E",
      "surface-2": "#2C2C2E",
      text: "#F5F5F7",
      accent: "#E4571C",
      "on-accent": "#FFFFFF",
      rail: "#1B1B1D",
    });
    expect(lightPalette).toMatchObject({
      bg: "#F2F2F7",
      "surface-2": "#FFFFFF",
      text: "#1C1C1E",
      accent: "#C2410C",
      "on-accent": "#FFFFFF",
      rail: "#1C1C1E",
    });
  });

  it("keeps text readable on every surface (WCAG contrast)", () => {
    for (const palette of [darkPalette, lightPalette]) {
      for (const surface of ["surface-1", "surface-2", "surface-3", "chat"] as const) {
        // Three-tier dark elevation (window -> elevated -> input) tops out near
        // 10:1 rather than 12:1; still well above AAA body text (7:1).
        expect(contrast(palette.text, palette[surface]), `text on ${surface}`).toBeGreaterThan(9);
        expect(
          contrast(palette["text-muted"], palette[surface]),
          `muted on ${surface}`,
        ).toBeGreaterThan(4.5);
      }
      // Outgoing bubbles and primary buttons: on-accent text over the accent.
      expect(contrast(palette["on-accent"], palette.accent)).toBeGreaterThan(3.5);
      expect(contrast(palette["rail-text"], palette.rail)).toBeGreaterThan(4.5);
    }
  });

  it("exposes theme-aware semantic colors with dark as default", () => {
    expect(theme.default).toBe("dark");
    expect(colors.dark).toBe(darkPalette);
    expect(colors.light).toBe(lightPalette);
    expect(tokens.color.dark).toBe(darkPalette);
    expect(tokens.color.light).toBe(lightPalette);
  });
});

describe("shape and type scales", () => {
  it("has the documented radii", () => {
    expect(radii.card).toBe("12px");
    expect(radii.input).toBe("10px");
    expect(radii.pill).toBe("999px");
  });

  it("has a spacing scale and a type scale", () => {
    expect(Object.keys(spacing).length).toBeGreaterThan(0);
    expect(tokens.typography.fontFamilies.sans.length).toBeGreaterThan(0);
    expect(tokens.typography.fontSizes.base).toBe("14px");
    expect(tokens.typography.fontFamilies.sans.join(" ")).toContain("Geist");
    expect(tokens.typography.fontFamilies.sans.join(" ")).toContain("Inter");
    expect(tokens.typography.fontFamilies.sans[0]).toBe("-apple-system");
    expect(tokens.typography.fontFamilies.mono.join(" ")).toContain("JetBrains Mono");
  });
});

describe("tailwind and nativewind presets", () => {
  it("expose the same color keys as the documented token set", () => {
    const tailwind = Object.keys(tailwindPreset.theme.extend.colors).sort();
    const nativewind = Object.keys(nativewindPreset.theme.extend.colors).sort();
    expect(tailwind).toEqual([...COLOR_TOKENS].sort());
    expect(nativewind).toEqual(tailwind);
  });

  it("default to the dark palette for web and native", () => {
    expect(tailwindPreset.theme.extend.colors).toMatchObject(darkPalette);
    expect(nativewindPreset.theme.extend.colors).toMatchObject(darkPalette);
  });

  it("carry the shared shape scale into both renderers", () => {
    expect(tailwindPreset.theme.extend.borderRadius.card).toBe("12px");
    expect(nativewindPreset.theme.extend.borderRadius.card).toBe("12px");
    expect(tailwindPreset.theme.extend.fontFamily.sans).toEqual(
      nativewindPreset.theme.extend.fontFamily.sans,
    );
  });
});

describe("css variables", () => {
  it("emits a variable per documented token", () => {
    const vars = cssVariables("light");
    for (const token of COLOR_TOKENS) {
      expect(vars[`--aulora-${token}`]).toBe(lightPalette[token]);
    }
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("icons", () => {
  it("ships non-empty, parseable path data for every icon", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    for (const name of ICON_NAMES) {
      const paths = iconPaths[name];
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d, name).toMatch(/^[Mm][-\d.]/);
        expect(d, name).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz\d.\-\s,]/);
      }
    }
  });
});
