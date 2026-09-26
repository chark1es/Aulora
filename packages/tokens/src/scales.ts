export const radii = {
  card: "20px",
  input: "14px",
  bubble: "14px",
  pill: "999px",
  sm: "8px",
  md: "12px",
  full: "9999px",
} as const;

export type RadiusToken = keyof typeof radii;

export const spacing = {
  0: "0px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

export type SpacingToken = keyof typeof spacing;

export const fontFamilies = {
  sans: ['"Geist"', '"Inter"', "system-ui", "-apple-system", "sans-serif"],
  mono: ['"Geist Mono"', '"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
} as const;

export type FontFamilyToken = keyof typeof fontFamilies;

export const fontSizes = {
  xs: "12px",
  sm: "13px",
  base: "14px",
  md: "15px",
  lg: "16px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "32px",
} as const;

export type FontSizeToken = keyof typeof fontSizes;

export const fontWeights = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const lineHeights = {
  tight: "1.2",
  normal: "1.5",
  relaxed: "1.75",
} as const;

export const typography = {
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
} as const;
