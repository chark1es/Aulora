import { COLOR_TOKENS, cssVariables, tailwindPresets } from "@aulora/tokens";
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/**
 * Tailwind v3.4 consumes the shared Aulora preset. Colors are exposed as
 * `--aulora-*` CSS variables so the `dark` class on `<html>` can switch themes
 * without duplicating hex values; the variables themselves come from
 * `@aulora/tokens` via `cssVariables`, emitted into the base layer here.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui-web/src/**/*.{ts,tsx}",
    "../../packages/avatars/src/**/*.{ts,tsx}",
  ],
  presets: [tailwindPresets.dark],
  theme: {
    extend: {
      colors: Object.fromEntries(COLOR_TOKENS.map((token) => [token, `var(--aulora-${token})`])),
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ":root": cssVariables("light"), ".dark": cssVariables("dark") });
    }),
  ],
};

export default config;
