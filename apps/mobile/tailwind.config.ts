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
    },
  },
};

export default config;
