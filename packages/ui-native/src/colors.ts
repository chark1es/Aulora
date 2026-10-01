import { darkPalette, IDLE_COLOR, lightPalette, type Palette } from "@aulora/tokens";

/** Ember needs a lighter foreground on native dark surfaces and dark button text. */
export const nativeDarkPalette: Palette = {
  ...darkPalette,
  accent: "#FF9B68",
  "accent-soft": "#FF9B6824",
  "on-accent": "#1C1C1E",
  danger: "#FF8585",
};
export const nativeLightPalette: Palette = { ...lightPalette, secondary: "#1E7935" };

export type ColorScheme = "dark" | "light";

/** Maps a color scheme (which can be `null` on native) onto an Aulora theme. */
export function paletteForScheme(scheme: string | null | undefined): Palette {
  return scheme === "light" ? nativeLightPalette : nativeDarkPalette;
}

/** Amber for idle, kept distinct from the Ember accent that marks unread. */
export { IDLE_COLOR };

/**
 * A neutral dark overlay used on top of the accent color (own message bubbles),
 * e.g. behind inline code, mentions and channel chips. Defined once so the web
 * and native renderers stay in step.
 */
export const ACCENT_OVERLAY = "rgba(0,0,0,0.2)";

/**
 * Presence dot color for a status; unknown statuses read as offline. Pass the
 * active palette (from {@link usePalette}) so the dot follows light/dark.
 */
export function presenceColor(status: string, palette: Palette = darkPalette): string {
  switch (status) {
    case "online":
      return palette.secondary;
    case "idle":
      return IDLE_COLOR;
    case "dnd":
      return palette.danger;
    default:
      return palette["text-muted"];
  }
}

export interface RoleRing {
  readonly borderColor: string;
  readonly borderWidth: number;
}

/**
 * A 2px role-color ring for an avatar, or `undefined` when no color is set.
 * Mirrors the ring `@aulora/avatars` draws on web.
 */
export function roleRing(roleColor: string | null | undefined): RoleRing | undefined {
  if (roleColor === null || roleColor === undefined || roleColor.length === 0) {
    return undefined;
  }
  return { borderColor: roleColor, borderWidth: 2 };
}
