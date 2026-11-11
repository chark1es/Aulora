import { COLOR_TOKENS, nativewindPreset } from "@aulora/tokens";
import type { Config } from "tailwindcss";

/**
 * NativeWind consumes the shared Aulora preset. Colors are exposed as
 * `--aulora-*` CSS variables (swapped at runtime by the theme provider via
 * NativeWind's `vars()`), so light and dark share one set of class names.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui-native/src/**/*.{ts,tsx}",
    "../../packages/avatars/src/native.tsx",
  ],
  presets: [require("nativewind/preset"), nativewindPreset],
  theme: {
    extend: {
      colors: Object.fromEntries(COLOR_TOKENS.map((token) => [token, `var(--aulora-${token})`])),
      fontSize: { xs: "13px", sm: "15px", base: "17px", md: "17px", lg: "20px" },
      // Touch-target sizes outside the shared 4px token scale. NativeWind's
      // native rem is 14, so an unmapped `h-11`/`min-h-11` would be 38.5dp, not
      // the 44dp minimum it is written for (measured on an Android emulator).
      spacing: { 9: "36px", 11: "44px" },
      maxWidth: {
        // Caps the pre-session content column on tablet/regular widths so a
        // primary button never stretches edge to edge (HIG: layout).
        content: "420px",
      },
    },
  },
};

export default config;
