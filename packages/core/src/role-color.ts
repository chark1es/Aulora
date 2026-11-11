/** A compact palette that reads well on both themes and beside blobatars. */
export const ROLE_COLOR_PRESETS = [
  "#C2410C",
  "#E4571C",
  "#0E9F8E",
  "#248A3D",
  "#7C5CFF",
  "#B24592",
  "#D70015",
  "#8E8E93",
] as const;

/**
 * Pure role-color helpers shared by the web and mobile clients.
 *
 * Role colors are picked by people, so a chosen color can be unreadable on one
 * or both appearances. These helpers parse the hex values, measure WCAG
 * contrast against real theme surfaces, classify the result and suggest a
 * minimally different shade that keeps the hue. Nothing here renders or talks
 * to the server.
 */

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface HslColor {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/** WCAG AA contrast for normal-sized body text. */
export const ROLE_COLOR_PASS_RATIO = 4.5;
/** WCAG AA for large text; below this a role name is hard to read. */
export const ROLE_COLOR_LOW_RATIO = 3;

/** Parse `#RGB` or `#RRGGBB` (a leading `#` is optional). */
export function parseHexColor(value: string): RgbColor | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (match === null) {
    return null;
  }
  const [, raw = ""] = match;
  if (raw.length === 0) {
    return null;
  }
  const hex =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => part + part)
          .join("")
      : raw;
  const int = Number.parseInt(hex, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === red) {
    h = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }
  return { h: h * 60, s, l };
}

/** `#RRGGBB`, uppercased, so stored role colors compare reliably. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [red, green, blue] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const channel = (component: number) =>
    Math.round((component + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

/** WCAG relative luminance, or `null` when the color cannot be parsed. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHexColor(color);
  if (rgb === null) {
    return null;
  }
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/** WCAG contrast ratio between two hex colors, or `null` when unparseable. */
export function contrastRatio(foreground: string, background: string): number | null {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  if (first === null || second === null) {
    return null;
  }
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export type RoleColorContrastLevel = "pass" | "low" | "fail";

/** >= 4.5 passes AA, >= 3 is low contrast, anything lower is hard to read. */
export function contrastLevel(ratio: number): RoleColorContrastLevel {
  if (ratio >= ROLE_COLOR_PASS_RATIO) {
    return "pass";
  }
  if (ratio >= ROLE_COLOR_LOW_RATIO) {
    return "low";
  }
  return "fail";
}

/** Text for a contrast level; pair it with an icon, never color alone. */
export function contrastLevelLabel(level: RoleColorContrastLevel): string {
  switch (level) {
    case "pass":
      return "Passes AA";
    case "low":
      return "Low contrast";
    case "fail":
      return "Hard to read";
  }
}

/** `4.6:1` with one decimal. Invalid ratios read as `—`. */
export function formatContrastRatio(ratio: number | null): string {
  return ratio === null || !Number.isFinite(ratio)
    ? "—"
    : `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

export type RoleColorTheme = "light" | "dark";

/** A real theme surface a role name is drawn on. */
export interface RoleColorPreviewSurface {
  readonly theme: RoleColorTheme;
  /** Hex background from the theme palette. */
  readonly background: string;
}

export interface RoleColorCheck extends RoleColorPreviewSurface {
  readonly ratio: number;
  readonly level: RoleColorContrastLevel;
  /** Human label for the level, e.g. “Low contrast”. */
  readonly label: string;
  /** Formatted ratio, e.g. `3.8:1`. */
  readonly ratioLabel: string;
}

/** Label of a check for a color that cannot be parsed. */
export const ROLE_COLOR_NO_COLOR_LABEL = "No color";

/** Contrast for a role color on each supplied theme surface. */
export function roleColorChecks(
  color: string,
  surfaces: readonly RoleColorPreviewSurface[],
): RoleColorCheck[] {
  return surfaces.map((surface) => {
    const ratio = contrastRatio(color, surface.background) ?? 0;
    const level = contrastLevel(ratio);
    return {
      theme: surface.theme,
      background: surface.background,
      ratio,
      level,
      label:
        contrastRatio(color, surface.background) === null
          ? ROLE_COLOR_NO_COLOR_LABEL
          : contrastLevelLabel(level),
      ratioLabel: formatContrastRatio(contrastRatio(color, surface.background)),
    };
  });
}

export interface ReadableRoleColorSuggestion {
  /** The suggested shade, hue preserved. */
  readonly color: string;
  /** Signed lightness change in 0–1 units; negative is darker. */
  readonly deltaLightness: number;
  /** True when every supplied surface clears the target ratio. */
  readonly passesTarget: boolean;
  /** The suggested shade's contrast on each supplied surface. */
  readonly checks: readonly RoleColorCheck[];
}

export interface SuggestReadableRoleColorOptions {
  /** Defaults to {@link ROLE_COLOR_PASS_RATIO}. */
  readonly targetRatio?: number;
}

/**
 * Find the nearest quantized HSL lightness that passes every requested surface.
 * Impossible combinations return null: a balanced failure is not a repair.
 */
export function suggestReadableRoleColor(
  color: string,
  surfaces: readonly RoleColorPreviewSurface[],
  options: SuggestReadableRoleColorOptions = {},
): ReadableRoleColorSuggestion | null {
  const rgb = parseHexColor(color);
  if (rgb === null || surfaces.length === 0) return null;
  const target = options.targetRatio ?? ROLE_COLOR_PASS_RATIO;
  const initial = roleColorChecks(color, surfaces);
  if (initial.every((check) => check.ratio >= target)) return null;
  const hsl = rgbToHsl(rgb);
  // Sub-byte lightness steps find the nearest paintable shade, not a whole-percent jump.
  // Walk outward from the picked lightness (darker wins a tie) and stop at the first repair.
  const steps = 10000;
  let down = Math.floor(hsl.l * steps);
  let up = Math.ceil(hsl.l * steps);
  while (down >= 0 || up <= steps) {
    const downDistance = down >= 0 ? hsl.l - down / steps : Number.POSITIVE_INFINITY;
    const upDistance = up <= steps ? up / steps - hsl.l : Number.POSITIVE_INFINITY;
    const useDown = downDistance <= upDistance;
    const l = (useDown ? down : up) / steps;
    if (useDown) down -= 1;
    else up += 1;
    const candidate = hslToHex(hsl.h, hsl.s, l);
    const checks = roleColorChecks(candidate, surfaces);
    if (
      checks.every((check, index) => {
        const initialRatio = initial.at(index)?.ratio ?? 0;
        return check.ratio >= target && (initialRatio < target || check.ratio >= initialRatio);
      }) &&
      !sameRgb(candidate, color)
    ) {
      return { color: candidate, deltaLightness: l - hsl.l, passesTarget: true, checks };
    }
  }
  return null;
}

/**
 * The repair for one failing theme: a shade that fixes it, or the passing theme
 * that every such shade would push below AA. Never neither.
 */
export type RoleColorRepairOutcome =
  | {
      /** The theme that fails AA and would be repaired. */
      readonly theme: RoleColorTheme;
      /**
       * A shade that fixes {@link theme}. Its `checks` cover every supplied
       * surface, so a caller can show what the shade does to the other theme.
       */
      readonly suggestion: ReadableRoleColorSuggestion;
      readonly blockedBy: null;
    }
  | {
      readonly theme: RoleColorTheme;
      readonly suggestion: null;
      /**
       * Every shade that fixes {@link theme} would drop this already-passing
       * theme below 4.5:1. For Aulora's real light/dark chat surfaces no colour
       * can pass both, so this is exact.
       */
      readonly blockedBy: RoleColorTheme;
    };

/** The lone-surface repair for `theme`; `null` when no shade fixes it even alone. */
function repairForTheme(
  color: string,
  surfaces: readonly RoleColorPreviewSurface[],
  theme: RoleColorTheme,
): RoleColorRepairOutcome | null {
  const surface = surfaces.find((entry) => entry.theme === theme);
  if (surface === undefined) return null;
  const alone = suggestReadableRoleColor(color, [surface]);
  if (alone === null) return null;
  const initial = roleColorChecks(color, surfaces);
  const checks = roleColorChecks(alone.color, surfaces);
  const blocker = initial.find(
    (check, index) =>
      check.ratio >= ROLE_COLOR_PASS_RATIO && (checks.at(index)?.ratio ?? 0) < check.ratio,
  );
  return blocker === undefined
    ? { theme, suggestion: { ...alone, checks }, blockedBy: null }
    : { theme, suggestion: null, blockedBy: blocker.theme };
}

/** Theme-specific repairs that never reduce contrast on an already passing theme. */
export function suggestRoleColorForTheme(
  color: string,
  surfaces: readonly RoleColorPreviewSurface[],
  theme: RoleColorTheme,
): ReadableRoleColorSuggestion | null {
  return repairForTheme(color, surfaces, theme)?.suggestion ?? null;
}

/**
 * Per failing theme: the safe repair, or the theme that blocks one. Themes that
 * already pass, invalid colours and unrepairable cases produce no entry.
 */
export function roleColorRepairs(
  color: string,
  surfaces: readonly RoleColorPreviewSurface[],
): RoleColorRepairOutcome[] {
  if (parseHexColor(color) === null) return [];
  const initial = roleColorChecks(color, surfaces);
  const outcomes: RoleColorRepairOutcome[] = [];
  for (const check of initial) {
    if (check.ratio >= ROLE_COLOR_PASS_RATIO) continue;
    const repair = repairForTheme(color, surfaces, check.theme);
    if (repair !== null) outcomes.push(repair);
  }
  return outcomes;
}

/**
 * Before/after contrast on every surface a suggestion was checked against, e.g.
 * `["Light 4.0:1 → 4.6:1", "Dark 3.9:1 → 2.1:1"]`. A repair for one theme can
 * lower the other, so both are listed, never only the repaired one.
 */
export function describeRoleColorRepairChange(
  before: readonly RoleColorCheck[],
  suggestion: ReadableRoleColorSuggestion,
): string[] {
  return suggestion.checks.map((after, index) => {
    const theme = after.theme === "light" ? "Light" : "Dark";
    return `${theme} ${before.at(index)?.ratioLabel ?? "—"} → ${after.ratioLabel}`;
  });
}

/** "Darker 12%" / "Lighter 8%"; a sub-1% change reads "Slightly darker" instead of "0%". */
export function describeLightnessChange(deltaLightness: number): string {
  const darker = deltaLightness < 0;
  const percent = Math.round(Math.abs(deltaLightness) * 100);
  if (percent === 0) return darker ? "Slightly darker" : "Slightly lighter";
  return `${darker ? "Darker" : "Lighter"} ${percent}%`;
}

/**
 * One-line summary of how a role color reads across themes. `null` when there
 * are no checks. Aulora's real surfaces make "every theme" unreachable, but the
 * helper stays correct for any surfaces.
 */
export function roleColorHeadline(checks: readonly RoleColorCheck[]): string | null {
  if (checks.length === 0) return null;
  if (checks.every((check) => check.label === ROLE_COLOR_NO_COLOR_LABEL)) return "No color set";
  const passing = checks.filter((check) => check.level === "pass").map((check) => check.theme);
  if (passing.length === checks.length) return "Passes AA on every theme";
  if (passing.length === 0) return "Passes AA on neither theme";
  return `Passes AA on ${passing.join(" and ")} only`;
}

function sameRgb(first: string, second: string): boolean {
  const a = parseHexColor(first);
  const b = parseHexColor(second);
  return a !== null && b !== null && a.r === b.r && a.g === b.g && a.b === b.b;
}

/** A valid hex role color, or `null` when the stored value cannot be painted. */
export function roleColorCss(color: string | null | undefined): string | null {
  const trimmed = color?.trim() ?? "";
  const rgb = parseHexColor(trimmed);
  return rgb === null
    ? null
    : `#${[rgb.r, rgb.g, rgb.b].map((part) => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * The color used to paint a role name: the picked color when it parses, else the
 * theme’s normal text color. Renderers and the picker preview both use this so
 * they never disagree about what a role color looks like.
 */
export function roleTextColor(color: string | null | undefined, fallback: string): string {
  return roleColorCss(color) ?? fallback;
}

/** The stable reference a member stores for a role (`key` wins over `id`). */
export function roleRef(role: { readonly id: string; readonly key?: string | null }): string {
  return role.key ?? role.id;
}

export interface RoleColorRole {
  readonly id: string;
  readonly key?: string | null;
  readonly color?: string | null;
  readonly position: number;
}

export interface RoleColorMember {
  readonly roleIds: readonly string[];
}

/**
 * The color that tints a member’s avatar ring and username: their
 * highest-position colored role. Shared by web and mobile so message headers,
 * member lists and the role picker preview agree.
 */
export function roleColorFor(
  member: RoleColorMember | null | undefined,
  roles: readonly RoleColorRole[],
): string | null {
  if (member === null || member === undefined) {
    return null;
  }
  const held = new Set(member.roleIds);
  let best: RoleColorRole | null = null;
  for (const role of roles) {
    const color = role.color?.trim() ?? "";
    if (color.length === 0 || parseHexColor(color) === null || !held.has(roleRef(role))) {
      continue;
    }
    if (best === null || role.position > best.position) {
      best = role;
    }
  }
  return roleColorCss(best?.color);
}

/** Names of a member’s roles, highest position first, skipping `@everyone`. */
export function roleNamesFor(
  member: RoleColorMember | null | undefined,
  roles: readonly (RoleColorRole & { readonly name: string; readonly isEveryone?: boolean })[],
): string[] {
  if (member === null || member === undefined) {
    return [];
  }
  const held = new Set(member.roleIds);
  return roles
    .filter((role) => role.isEveryone !== true && held.has(roleRef(role)))
    .sort((a, b) => b.position - a.position)
    .map((role) => role.name);
}
