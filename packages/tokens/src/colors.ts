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
  "on-accent",
  "secondary",
  "danger",
  "rail",
  "rail-text",
  "chat",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export type Palette = { readonly [K in ColorToken]: string };

/**
 * Dark theme ("Loam"): Apple-style system neutrals (near-black window, lighter
 * elevated surfaces) with Ember kept as a signal, not a wash. `accent` is dark
 * enough that white-on-accent stays above 3.5:1 for outgoing bubbles.
 */
export const darkPalette = {
  bg: "#1C1C1E",
  "grid-dot": "#2C2C2E",
  "surface-1": "#242426",
  "surface-2": "#2C2C2E",
  "surface-3": "#3A3A3C",
  border: "#38383A",
  text: "#F5F5F7",
  "text-muted": "#A6A6AE",
  accent: "#E4571C",
  "accent-soft": "#E4571C24",
  "on-accent": "#FFFFFF",
  secondary: "#4CD964",
  danger: "#FF6B6B",
  rail: "#1B1B1D",
  "rail-text": "#A6A6AE",
  chat: "#1C1C1E",
} as const satisfies Palette;

/**
 * Light theme ("Linen"): system grouped canvas, white content, a soft-gray
 * sidebar and the same dark rail so the workspace switcher reads as one object
 * in both appearances. White on `accent` is ~5.2:1.
 */
export const lightPalette = {
  bg: "#F2F2F7",
  "grid-dot": "#E5E5EA",
  "surface-1": "#F7F7FA",
  "surface-2": "#FFFFFF",
  "surface-3": "#EFEFF4",
  border: "#D9D9DE",
  text: "#1C1C1E",
  "text-muted": "#636366",
  accent: "#C2410C",
  "accent-soft": "#C2410C14",
  "on-accent": "#FFFFFF",
  secondary: "#248A3D",
  danger: "#D70015",
  rail: "#1C1C1E",
  "rail-text": "#A6A6AE",
  chat: "#FFFFFF",
} as const satisfies Palette;

export const palettes = {
  dark: darkPalette,
  light: lightPalette,
} as const;

export function paletteFor(theme: ThemeName): Palette {
  return theme === "light" ? lightPalette : darkPalette;
}
