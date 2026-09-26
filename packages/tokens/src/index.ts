export {
  COLOR_TOKENS,
  type ColorToken,
  darkPalette,
  lightPalette,
  type Palette,
  paletteFor,
  palettes,
  type ThemeName,
} from "./colors";
export {
  type AuloraPreset,
  type AuloraPresets,
  createNativewindPreset,
  createPreset,
  createTailwindPreset,
  cssVariables,
  nativewindPreset,
  nativewindPresets,
  tailwindPreset,
  tailwindPresets,
} from "./presets";
export {
  type FontFamilyToken,
  type FontSizeToken,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  type RadiusToken,
  radii,
  type SpacingToken,
  spacing,
  typography,
} from "./scales";

import { darkPalette, lightPalette, palettes } from "./colors";
import {
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  spacing,
  typography,
} from "./scales";

/** One source of truth for every design token. */
export const tokens = {
  color: palettes,
  radius: radii,
  spacing,
  typography,
} as const;

/** Semantic, theme-aware colors. `colors.dark` is the default theme. */
export const colors = {
  dark: darkPalette,
  light: lightPalette,
} as const;

export const theme = {
  default: "dark",
  modes: ["dark", "light"],
} as const;

export const scales = {
  radii,
  spacing,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  typography,
} as const;
