import { darkPalette, lightPalette, type Palette } from "@aulora/tokens";

export type ColorScheme = "dark" | "light";

/** Maps a color scheme (which can be `null` on native) onto an Aulora theme. */
export function paletteForScheme(scheme: string | null | undefined): Palette {
  return scheme === "light" ? lightPalette : darkPalette;
}

/** Amber for idle, kept distinct from the Ember accent that marks unread. */
export const IDLE_COLOR = "#E8A33B";

const PRESENCE_COLORS: Record<string, string> = {
  online: darkPalette.secondary,
  idle: IDLE_COLOR,
  dnd: darkPalette.danger,
  offline: darkPalette["text-muted"],
};

/** Presence dot color for a status; unknown statuses read as offline. */
export function presenceColor(status: string): string {
  return PRESENCE_COLORS[status] ?? darkPalette["text-muted"];
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
