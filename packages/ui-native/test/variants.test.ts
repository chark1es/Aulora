import { darkPalette, lightPalette } from "@aulora/tokens";
import { describe, expect, it } from "vitest";
import { paletteForScheme, presenceColor, roleRing } from "../src/colors";
import {
  buttonClass,
  buttonLabelClass,
  iconButtonClass,
  inputClass,
  textClass,
} from "../src/variants";

describe("paletteForScheme", () => {
  it("uses the dark Loam palette by default and for `null`", () => {
    expect(paletteForScheme("dark")).toBe(darkPalette);
    expect(paletteForScheme(null)).toBe(darkPalette);
    expect(paletteForScheme(undefined)).toBe(darkPalette);
  });

  it("uses the light Linen palette only for `light`", () => {
    expect(paletteForScheme("light")).toBe(lightPalette);
    expect(paletteForScheme("unspecified")).toBe(darkPalette);
  });
});

describe("presenceColor", () => {
  it("maps the four statuses and falls back to muted", () => {
    expect(presenceColor("online")).toBe(darkPalette.secondary);
    expect(presenceColor("idle")).toBe(darkPalette.accent);
    expect(presenceColor("dnd")).toBe(darkPalette.danger);
    expect(presenceColor("offline")).toBe(darkPalette["text-muted"]);
    expect(presenceColor("away")).toBe(darkPalette["text-muted"]);
  });
});

describe("roleRing", () => {
  it("returns a 2px ring only for a non-empty color", () => {
    expect(roleRing("#F5A45B")).toEqual({ borderColor: "#F5A45B", borderWidth: 2 });
    expect(roleRing("")).toBeUndefined();
    expect(roleRing(null)).toBeUndefined();
    expect(roleRing(undefined)).toBeUndefined();
  });
});

describe("class composers", () => {
  it("includes the variant, size and disabled state for buttons", () => {
    const primary = buttonClass({ variant: "primary", size: "sm" });
    expect(primary).toContain("bg-accent");
    expect(primary).toContain("h-8");
    expect(primary).toContain("rounded-pill");

    const disabled = buttonClass({ variant: "danger", size: "lg", disabled: true });
    expect(disabled).toContain("bg-danger");
    expect(disabled).toContain("opacity-50");
  });

  it("keeps button labels legible per variant", () => {
    expect(buttonLabelClass("primary")).toBe("text-bg");
    expect(buttonLabelClass("ghost")).toBe("text-text-muted");
  });

  it("composes icon button and input classes", () => {
    expect(iconButtonClass({ variant: "secondary", size: "md" })).toContain("h-10");
    expect(inputClass({ error: true })).toContain("border-danger");
    expect(inputClass()).toContain("border-border");
  });

  it("appends custom class names and applies the mono font", () => {
    expect(textClass({ size: "xs", mono: true, className: "px-2" })).toContain("font-mono");
    expect(textClass({ size: "xs", mono: true, className: "px-2" })).toContain("px-2");
  });
});
