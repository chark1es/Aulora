import {
  COLOR_TOKENS,
  colors,
  cssVariables,
  darkPalette,
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
      "secondary",
      "danger",
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

  it("matches the exact plan.md values for dark (Loam) and light (Linen)", () => {
    expect(darkPalette).toMatchObject({
      bg: "#0A0A0C",
      "grid-dot": "#1A1A1F",
      "surface-1": "#111114",
      "surface-2": "#17171B",
      "surface-3": "#1F1F24",
      border: "#26262C",
      text: "#ECEBEF",
      "text-muted": "#8B8A94",
      accent: "#F5A45B",
      "accent-soft": "#F5A45B1F",
      secondary: "#8FD19E",
      danger: "#F2777A",
    });
    expect(lightPalette).toMatchObject({
      bg: "#F4F2EE",
      "grid-dot": "#E2DED6",
      "surface-1": "#FBFAF7",
      "surface-2": "#FFFFFF",
      "surface-3": "#EEEBE5",
      border: "#DDD8CF",
      text: "#18171B",
      "text-muted": "#6B6873",
      accent: "#A8530F",
      "accent-soft": "#A8530F14",
      secondary: "#2F7A45",
      danger: "#C23A3E",
    });
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
    expect(radii.card).toBe("20px");
    expect(radii.input).toBe("14px");
    expect(radii.pill).toBe("999px");
  });

  it("has a spacing scale and a type scale", () => {
    expect(Object.keys(spacing).length).toBeGreaterThan(0);
    expect(tokens.typography.fontFamilies.sans.length).toBeGreaterThan(0);
    expect(tokens.typography.fontSizes.base).toBe("14px");
    expect(tokens.typography.fontFamilies.sans.join(" ")).toContain("Geist");
    expect(tokens.typography.fontFamilies.sans.join(" ")).toContain("Inter");
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
    expect(tailwindPreset.theme.extend.borderRadius.card).toBe("20px");
    expect(nativewindPreset.theme.extend.borderRadius.card).toBe("20px");
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
