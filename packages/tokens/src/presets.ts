import { type Palette, paletteFor, type ThemeName } from "./colors";
import { fontFamilies, fontSizes, radii, spacing } from "./scales";

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
}

export function createPreset(palette: Palette): AuloraPreset {
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
        fontFamily: {
          sans: [...fontFamilies.sans],
          mono: [...fontFamilies.mono],
        },
        fontSize: { ...fontSizes },
      },
    },
  };
}

export type AuloraPresets = {
  readonly dark: AuloraPreset;
  readonly light: AuloraPreset;
};

export function createTailwindPreset(theme: ThemeName = "dark"): AuloraPreset {
  return createPreset(paletteFor(theme));
}

export function createNativewindPreset(theme: ThemeName = "dark"): AuloraPreset {
  return createPreset(paletteFor(theme));
}

export const tailwindPresets: AuloraPresets = {
  dark: createPreset(paletteFor("dark")),
  light: createPreset(paletteFor("light")),
};

export const nativewindPresets: AuloraPresets = {
  dark: createPreset(paletteFor("dark")),
  light: createPreset(paletteFor("light")),
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
