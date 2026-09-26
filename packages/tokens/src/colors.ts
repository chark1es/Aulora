export type ThemeName = "dark" | "light";

export const COLOR_TOKENS = [
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
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export type Palette = { readonly [K in ColorToken]: string };

/** Dark theme ("Loam"), the default. Values match plan.md "Palettes" exactly. */
export const darkPalette = {
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
} as const satisfies Palette;

/** Light theme ("Linen"). Values match plan.md "Palettes" exactly. */
export const lightPalette = {
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
} as const satisfies Palette;

export const palettes = {
  dark: darkPalette,
  light: lightPalette,
} as const;

export function paletteFor(theme: ThemeName): Palette {
  return theme === "light" ? lightPalette : darkPalette;
}
