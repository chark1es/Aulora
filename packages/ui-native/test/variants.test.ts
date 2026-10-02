import { darkPalette } from "@aulora/tokens";
import { describe, expect, it } from "vitest";
import {
  IDLE_COLOR,
  nativeDarkPalette,
  nativeLightPalette,
  paletteForScheme,
  presenceColor,
  roleRing,
} from "../src/colors";
import {
  buttonClass,
  buttonLabelClass,
  buttonLabelText,
  iconButtonClass,
  inputClass,
  textClass,
} from "../src/variants";

describe("paletteForScheme", () => {
  it("uses the native dark palette by default and for `null`", () => {
    expect(paletteForScheme("dark")).toBe(nativeDarkPalette);
    expect(paletteForScheme(null)).toBe(nativeDarkPalette);
    expect(paletteForScheme(undefined)).toBe(nativeDarkPalette);
  });

  it("uses the native light palette only for `light`", () => {
    expect(paletteForScheme("light")).toBe(nativeLightPalette);
    expect(paletteForScheme("unspecified")).toBe(nativeDarkPalette);
  });
});

describe("presenceColor", () => {
  it("maps the four statuses and falls back to muted", () => {
    expect(presenceColor("online")).toBe(darkPalette.secondary);
    expect(presenceColor("idle")).toBe(IDLE_COLOR);
    expect(presenceColor("idle")).not.toBe(darkPalette.accent);
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
    expect(primary).toContain("min-h-12");
    expect(primary).toContain("rounded-input");

    const disabled = buttonClass({ variant: "danger", size: "lg", disabled: true });
    expect(disabled).toContain("bg-danger");
    expect(disabled).toContain("opacity-50");
  });

  it("keeps button labels legible per variant", () => {
    expect(buttonLabelClass("primary")).toBe("text-on-accent");
    expect(buttonLabelClass("ghost")).toBe("text-text-muted");
  });

  it("composes icon button and input classes", () => {
    expect(iconButtonClass({ variant: "secondary", size: "md" })).toContain("h-12");
    expect(inputClass({ error: true })).toContain("border-danger");
    expect(inputClass()).toContain("border-border");
  });

  it("lets both input sizes grow with system text size", () => {
    const defaultMd = inputClass();
    expect(inputClass({ size: "md" })).toBe(defaultMd);
    expect(defaultMd).toContain("min-h-12");
    expect(defaultMd).toContain("text-[17px]");

    const lg = inputClass({ size: "lg" });
    expect(lg).not.toContain("h-10");
    expect(lg).toContain("min-h-[52px]");
    expect(lg).toContain("text-[17px]");
    expect(inputClass({ size: "lg", error: true })).toContain("border-danger");
  });

  it("appends custom class names and applies the mono font", () => {
    expect(textClass({ size: "xs", mono: true, className: "px-2" })).toContain("font-mono");
    expect(textClass({ size: "xs", mono: true, className: "px-2" })).toContain("px-2");
  });
});

describe("buttonLabelText", () => {
  it("joins a label built from several text pieces", () => {
    expect(buttonLabelText("Send")).toBe("Send");
    expect(buttonLabelText(["Continue with ", "Keycloak"])).toBe("Continue with Keycloak");
    expect(buttonLabelText(["Start group message (", 3, ")"])).toBe("Start group message (3)");
  });

  it("skips the empty values a conditional leaves behind", () => {
    expect(buttonLabelText(["Save", false])).toBe("Save");
    expect(buttonLabelText(["Save", null, undefined, "…"])).toBe("Save…");
    expect(buttonLabelText([false, null])).toBeNull();
  });

  it("leaves element children to the caller", () => {
    expect(buttonLabelText({ type: "Icon" })).toBeNull();
    expect(buttonLabelText(["Save", { type: "Icon" }])).toBeNull();
    expect(buttonLabelText(undefined)).toBeNull();
  });
});
