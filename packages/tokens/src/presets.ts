import { type Palette, paletteFor, type ThemeName } from "./colors";
import { fontFamilies, nativeFontFamilies, nativeFontFamily } from "./fonts";
import { fontSizes, radii, spacing } from "./scales";

/** The subset of Tailwind's plugin API the presets use (no tailwindcss dependency). */
export type PresetPlugin = (api: {
  addUtilities: (utilities: Record<string, Record<string, string>>) => void;
}) => void;

export interface AuloraPreset {
  theme: {
    extend: {
      colors: Record<string, string>;
      borderRadius: Record<string, string>;
      spacing: Record<string, string>;
      fontFamily: Record<string, string[]>;
      fontSize: Record<string, string>;
    };
  };
  plugins: PresetPlugin[];
}

type PresetTarget = "web" | "native";

const NATIVE_WEIGHT_CLASSES = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

/**
 * React Native selects a static face by family name, not by weight, so each
 * weight utility also switches to the matching Inter file.
 */
const nativeWeightFamilies: PresetPlugin = ({ addUtilities }) => {
  addUtilities(
    Object.fromEntries(
      Object.entries(NATIVE_WEIGHT_CLASSES).map(([name, weight]) => [
        `.font-${name}`,
        { "font-family": nativeFontFamily(weight) },
      ]),
    ),
  );
};

function fontFamilyFor(target: PresetTarget): Record<string, string[]> {
  if (target === "native") {
    return { sans: [nativeFontFamilies.sans[400]], mono: [nativeFontFamilies.mono[400]] };
  }
  return { sans: [...fontFamilies.sans], mono: [...fontFamilies.mono] };
}

export function createPreset(palette: Palette, target: PresetTarget = "web"): AuloraPreset {
  return {
    theme: {
      extend: {
        colors: { ...palette },
        borderRadius: {
          card: radii.card,
          input: radii.input,
          bubble: radii.bubble,
          pill: radii.pill,
          sm: radii.sm,
          md: radii.md,
        },
        spacing: { ...spacing },
        fontFamily: fontFamilyFor(target),
        fontSize: { ...fontSizes },
      },
    },
    plugins: target === "native" ? [nativeWeightFamilies] : [],
  };
}

export type AuloraPresets = {
  readonly dark: AuloraPreset;
  readonly light: AuloraPreset;
};

export function createTailwindPreset(theme: ThemeName = "dark"): AuloraPreset {
  return createPreset(paletteFor(theme), "web");
}

export function createNativewindPreset(theme: ThemeName = "dark"): AuloraPreset {
  return createPreset(paletteFor(theme), "native");
}

export const tailwindPresets: AuloraPresets = {
  dark: createTailwindPreset("dark"),
  light: createTailwindPreset("light"),
};

export const nativewindPresets: AuloraPresets = {
  dark: createNativewindPreset("dark"),
  light: createNativewindPreset("light"),
};

/** Default presets use the dark theme. */
export const tailwindPreset: AuloraPreset = tailwindPresets.dark;
export const nativewindPreset: AuloraPreset = nativewindPresets.dark;

export function cssVariables(theme: ThemeName = "dark"): Record<string, string> {
  const palette = paletteFor(theme);
  const vars: Record<string, string> = {};
  for (const [token, value] of Object.entries(palette)) {
    vars[`--aulora-${token}`] = value;
  }
  return vars;
}
