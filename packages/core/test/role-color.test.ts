import { describe, expect, it } from "vitest";
import {
  contrastLevel,
  contrastLevelLabel,
  contrastRatio,
  describeLightnessChange,
  describeRoleColorRepairChange,
  formatContrastRatio,
  hslToHex,
  parseHexColor,
  ROLE_COLOR_PRESETS,
  relativeLuminance,
  rgbToHsl,
  roleColorChecks,
  roleColorCss,
  roleColorFor,
  roleColorHeadline,
  roleColorRepairs,
  roleNamesFor,
  roleRef,
  roleTextColor,
  suggestReadableRoleColor,
  suggestRoleColorForTheme,
} from "../src/role-color";

// Hex literals mirror paletteFor("light"|"dark").chat from @aulora/tokens, which the
// previews paint on. packages/ui-web/test/role-color-surfaces.test.ts asserts they
// match and runs the sweeps against the real palette (core does not depend on tokens).
/** These sweep hundreds of colors through a 10,000-step search; shared CI runners are far slower. */
const HEAVY_TEST_TIMEOUT_MS = 30_000;

const LIGHT = { theme: "light" as const, background: "#FFFFFF" };
const DARK = { theme: "dark" as const, background: "#1C1C1E" };
// Synthetic pair whose passing sets overlap, so one theme can pass while the other is
// repairable without regressing it. Real surfaces never overlap; this exercises the algorithm.
const PAPER = { theme: "light" as const, background: "#FFFFFF" };
const SLATE = { theme: "dark" as const, background: "#B0B0B0" };

describe("role color math", () => {
  it("parses short and long hex colors", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("0e9f8e")).toEqual({ r: 14, g: 159, b: 142 });
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("rebeccapurple")).toBeNull();
  });

  it("keeps HSL and hex round-trips stable", () => {
    expect(hslToHex(16, 0.72, 0.55)).toMatch(/^#[0-9A-F]{6}$/);
    const rgb = parseHexColor("#C2410C");
    expect(rgb).not.toBeNull();
    if (rgb === null) return;
    const hsl = rgbToHsl(rgb);
    expect(parseHexColor(hslToHex(hsl.h, hsl.s, hsl.l))).toEqual(rgb);
  });

  it("matches WCAG reference ratios", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("not-a-color", "#FFFFFF")).toBeNull();
  });

  it("ships only parseable preset colors", () => {
    expect(ROLE_COLOR_PRESETS.length).toBeGreaterThan(0);
    for (const preset of ROLE_COLOR_PRESETS) {
      expect(parseHexColor(preset), preset).not.toBeNull();
    }
  });

  it("classifies pass, low and hard-to-read boundaries", () => {
    expect(contrastLevel(4.5)).toBe("pass");
    expect(contrastLevel(7)).toBe("pass");
    expect(contrastLevel(4.49)).toBe("low");
    expect(contrastLevel(3)).toBe("low");
    expect(contrastLevel(2.99)).toBe("fail");
    expect(contrastLevelLabel("pass")).toBe("Passes AA");
    expect(contrastLevelLabel("low")).toBe("Low contrast");
    expect(contrastLevelLabel("fail")).toBe("Hard to read");
    expect(formatContrastRatio(3.84)).toBe("3.8:1");
    expect(formatContrastRatio(null)).toBe("—");
  });
});

describe("roleColorChecks", () => {
  it("reports one check per supplied theme surface", () => {
    const checks = roleColorChecks("#7C5CFF", [LIGHT, DARK]);
    expect(checks).toHaveLength(2);
    expect(checks[0]?.theme).toBe("light");
    expect(checks[1]?.theme).toBe("dark");
    expect(checks[0]?.ratio).toBeGreaterThan(0);
    expect(checks[0]?.ratioLabel).toMatch(/:1$/);
  });

  it("flags a mid purple as low on both real surfaces", () => {
    const [light, dark] = roleColorChecks("#7C5CFF", [LIGHT, DARK]);
    expect(light?.level).toBe("low");
    expect(dark?.level).toBe("low");
  });

  it("flags a very dark color as hard to read on a dark surface", () => {
    expect(roleColorChecks("#1C1C1E", [DARK])[0]?.level).toBe("fail");
  });

  it("accepts a color that clears both surfaces", () => {
    const checks = roleColorChecks("#000000", [LIGHT, { theme: "dark", background: "#F5F5F7" }]);
    expect(checks.every((check) => check.level === "pass")).toBe(true);
  });
});

describe("suggestReadableRoleColor", () => {
  it("returns null when the color already passes or is invalid", () => {
    expect(suggestReadableRoleColor("#000000", [LIGHT])).toBeNull();
    expect(suggestReadableRoleColor("nope", [LIGHT])).toBeNull();
    expect(suggestReadableRoleColor("#7C5CFF", [])).toBeNull();
  });

  it("keeps the hue while darkening an unreadable light-theme color", () => {
    const suggestion = suggestReadableRoleColor("#7C5CFF", [LIGHT]);
    expect(suggestion).not.toBeNull();
    if (suggestion === null) return;
    expect(suggestion.passesTarget).toBe(true);
    expect(suggestion.deltaLightness).toBeLessThan(0);
    const before = parseHexColor("#7C5CFF");
    const after = parseHexColor(suggestion.color);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (before === null || after === null) return;
    const hslBefore = rgbToHsl(before);
    const hslAfter = rgbToHsl(after);
    expect(Math.abs(hslBefore.h - hslAfter.h)).toBeLessThan(1);
    expect(Math.abs(hslBefore.s - hslAfter.s)).toBeLessThan(0.01);
    expect(suggestion.checks[0]?.level).toBe("pass");
  });

  it("moves minimally rather than jumping to an extreme", () => {
    const suggestion = suggestReadableRoleColor("#7C5CFF", [LIGHT]);
    expect(suggestion).not.toBeNull();
    if (suggestion === null) return;
    // A minimal nudge, not white or black.
    expect(Math.abs(suggestion.deltaLightness)).toBeLessThan(0.45);
  });

  it("does not offer a balanced failure for incompatible surfaces", () => {
    expect(suggestReadableRoleColor("#7C5CFF", [LIGHT, DARK])).toBeNull();
  });

  it(
    "never regresses a passing surface on the real-looking light/dark pair",
    () => {
      const colors = [
        ...ROLE_COLOR_PRESETS,
        ...Array.from({ length: 128 }, (_, i) => hslToHex(i * 137.5, (i % 5) / 4, (i % 11) / 10)),
      ];
      for (const color of colors) {
        for (const theme of ["light", "dark"] as const) {
          const suggestion = suggestRoleColorForTheme(color, [LIGHT, DARK], theme);
          if (suggestion === null) continue;
          expect(
            suggestion.checks.find((check) => check.theme === theme)?.ratio,
          ).toBeGreaterThanOrEqual(4.5);
          const before = roleColorChecks(color, [LIGHT, DARK]);
          const after = roleColorChecks(suggestion.color, [LIGHT, DARK]);
          before.forEach((check, i) => {
            if (check.ratio >= 4.5) expect(after[i]?.ratio).toBeGreaterThanOrEqual(check.ratio);
          });
        }
      }
      expect(roleColorChecks("bad input", [LIGHT])[0]?.ratioLabel).toBe("—");
      expect(formatContrastRatio(4.499)).toBe("4.4:1");
      expect(roleColorCss("abc")).toBe("#AABBCC");
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it("repairs the failing theme without regressing the passing one (overlapping surfaces)", () => {
    // Grays darker than ~L 0.18 pass on PAPER; those above ~L 0.058 fail on SLATE.
    let repaired = 0;
    for (let l = 0.2; l <= 0.55; l += 0.01) {
      const color = hslToHex(0, 0, l);
      const before = roleColorChecks(color, [PAPER, SLATE]);
      const paperPasses = (before[0]?.ratio ?? 0) >= 4.5;
      const slatePasses = (before[1]?.ratio ?? 0) >= 4.5;
      if (!paperPasses || slatePasses) continue;
      const suggestion = suggestRoleColorForTheme(color, [PAPER, SLATE], "dark");
      expect(suggestion, color).not.toBeNull();
      if (suggestion === null) continue;
      repaired += 1;
      const after = roleColorChecks(suggestion.color, [PAPER, SLATE]);
      expect(after[1]?.ratio).toBeGreaterThanOrEqual(4.5);
      expect(after[0]?.ratio).toBeGreaterThanOrEqual(before[0]?.ratio ?? 99);
      const repairs = roleColorRepairs(color, [PAPER, SLATE]);
      expect(repairs).toEqual([{ theme: "dark", suggestion, blockedBy: null }]);
    }
    expect(repaired).toBeGreaterThan(5);
  });
});

describe("roleColorRepairs and roleColorHeadline", () => {
  it("names the passing theme that blocks a repair", () => {
    // #C2410C: light 5.18:1 passes, dark 3.29:1 does not, and no shade fixes dark
    // without pushing light below 4.5:1.
    const checks = roleColorChecks("#C2410C", [LIGHT, DARK]);
    expect(checks.map((check) => check.level)).toEqual(["pass", "low"]);
    expect(roleColorRepairs("#C2410C", [LIGHT, DARK])).toEqual([
      { theme: "dark", suggestion: null, blockedBy: "light" },
    ]);
    expect(roleColorHeadline(checks)).toBe("Passes AA on light only");
  });

  it("offers a repair per theme when both fail", () => {
    const repairs = roleColorRepairs("#7C5CFF", [LIGHT, DARK]);
    expect(repairs.map((repair) => repair.theme)).toEqual(["light", "dark"]);
    for (const repair of repairs) {
      expect(repair.blockedBy).toBeNull();
      expect(repair.suggestion?.passesTarget).toBe(true);
    }
    expect(roleColorHeadline(roleColorChecks("#7C5CFF", [LIGHT, DARK]))).toBe(
      "Passes AA on neither theme",
    );
  });

  it(
    "never leaves a refused repair without the theme that blocks it",
    () => {
      for (const color of [
        ...ROLE_COLOR_PRESETS,
        ...Array.from({ length: 96 }, (_, i) => hslToHex(i * 61, (i % 5) / 4, (i % 9) / 8)),
      ]) {
        for (const repair of roleColorRepairs(color, [LIGHT, DARK])) {
          if (repair.suggestion === null) {
            expect(repair.blockedBy, color).not.toBeNull();
            expect(repair.blockedBy, color).not.toBe(repair.theme);
          } else {
            expect(repair.blockedBy, color).toBeNull();
          }
        }
      }
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it("carries the suggestion's contrast on every theme, not only the repaired one", () => {
    const [light, dark] = roleColorRepairs("#7C5CFF", [LIGHT, DARK]);
    expect(light?.suggestion?.checks.map((check) => check.theme)).toEqual(["light", "dark"]);
    expect(dark?.suggestion?.checks.map((check) => check.theme)).toEqual(["light", "dark"]);
    if (light?.suggestion == null || dark?.suggestion == null) throw new Error("no repair");
    expect(light.suggestion.checks[0]?.ratio).toBeGreaterThanOrEqual(4.5);
    expect(dark.suggestion.checks[1]?.ratio).toBeGreaterThanOrEqual(4.5);
    // Fixing one theme of a both-failing colour lowers the other, and the note says so.
    const before = roleColorChecks("#7C5CFF", [LIGHT, DARK]);
    expect(describeRoleColorRepairChange(before, light.suggestion)).toEqual([
      "Light 4.3:1 → 4.5:1",
      "Dark 3.9:1 → 3.7:1",
    ]);
    expect(describeRoleColorRepairChange(before, dark.suggestion)).toEqual([
      "Light 4.3:1 → 3.7:1",
      "Dark 3.9:1 → 4.5:1",
    ]);
  });

  it("calls an unparseable colour 'No color set', not a contrast failure", () => {
    expect(roleColorHeadline(roleColorChecks("nope", [LIGHT, DARK]))).toBe("No color set");
    expect(roleColorHeadline(roleColorChecks("#7C5CFF", [LIGHT, DARK]))).toBe(
      "Passes AA on neither theme",
    );
  });

  it("offers nothing for passing, invalid or empty input", () => {
    expect(roleColorRepairs("#000000", [LIGHT])).toEqual([]);
    expect(roleColorRepairs("nope", [LIGHT, DARK])).toEqual([]);
    expect(roleColorRepairs("", [LIGHT, DARK])).toEqual([]);
    expect(roleColorHeadline([])).toBeNull();
    expect(roleColorHeadline(roleColorChecks("#000000", [LIGHT, PAPER]))).toBe(
      "Passes AA on every theme",
    );
  });
});

describe("role rendering helpers", () => {
  const roles = [
    { id: "everyone", key: null, name: "@everyone", color: null, position: 0, isEveryone: true },
    { id: "member", key: "member", name: "Member", color: "#248A3D", position: 2 },
    { id: "mod", key: "mod", name: "Moderator", color: "#E8A33B", position: 5 },
    { id: "admin", key: "admin", name: "Admin", color: "garbage", position: 9 },
  ];

  it("uses the highest-position valid color and skips invalid ones", () => {
    expect(roleColorFor({ roleIds: ["member", "mod", "admin"] }, roles)).toBe("#E8A33B");
    expect(roleColorFor({ roleIds: ["member"] }, roles)).toBe("#248A3D");
    expect(roleColorFor(null, roles)).toBeNull();
  });

  it("lists role names highest first without @everyone", () => {
    expect(roleNamesFor({ roleIds: ["member", "mod", "everyone"] }, roles)).toEqual([
      "Moderator",
      "Member",
    ]);
  });

  it("resolves a stable role ref and safe text color", () => {
    expect(roleRef({ id: "_id", key: "mod" })).toBe("mod");
    expect(roleRef({ id: "_id", key: null })).toBe("_id");
    expect(roleColorCss("#7C5CFF")).toBe("#7C5CFF");
    expect(roleColorCss("")).toBeNull();
    expect(roleColorCss("not-hex")).toBeNull();
    expect(roleTextColor("#7C5CFF", "#F5F5F7")).toBe("#7C5CFF");
    expect(roleTextColor("", "#F5F5F7")).toBe("#F5F5F7");
    expect(roleTextColor("not-hex", "#F5F5F7")).toBe("#F5F5F7");
  });
});

describe("describeLightnessChange", () => {
  it("never reports a visible shift as 0%", () => {
    expect(describeLightnessChange(-0.00474)).toBe("Slightly darker");
    expect(describeLightnessChange(0.003)).toBe("Slightly lighter");
    expect(describeLightnessChange(-0.12)).toBe("Darker 12%");
    expect(describeLightnessChange(0.08)).toBe("Lighter 8%");
  });
});
