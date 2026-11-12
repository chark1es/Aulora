export {
  COLOR_TOKENS,
  type ColorToken,
  darkPalette,
  IDLE_COLOR,
  lightPalette,
  MENTION_BACKGROUND,
  MENTION_COLOR,
  type Palette,
  paletteFor,
  palettes,
  type ThemeName,
} from "./colors";
export {
  emailFontStack,
  type FontFamilyToken,
  fontFaceRules,
  fontFamilies,
  fontFeatures,
  fontMetrics,
  fontStack,
  type NativeFontWeight,
  nativeFontFamilies,
  nativeFontFamily,
  nativeFontWeight,
  preloadFontFiles,
  type WebFontFace,
  webFontFaces,
} from "./fonts";
export {
  type AuloraPreset,
  type AuloraPresets,
  createNativewindPreset,
  createPreset,
  createTailwindPreset,
  cssVariables,
  nativewindPreset,
  nativewindPresets,
  type PresetPlugin,
  tailwindPreset,
  tailwindPresets,
} from "./presets";
export {
  type FontSizeToken,
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
import { fontFamilies } from "./fonts";
import { fontSizes, fontWeights, lineHeights, radii, spacing, typography } from "./scales";

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
export {
  type BrandIcon,
  type BrandIconPath,
  brandIcons,
  type ProviderBrand,
  providerBrand,
  providerButtonLabel,
} from "./brands";
export { ICON_NAMES, type IconName, iconPaths } from "./icons";
