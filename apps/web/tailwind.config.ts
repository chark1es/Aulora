import { COLOR_TOKENS, cssVariables, IDLE_COLOR, tailwindPresets } from "@aulora/tokens";
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
      // `color-mix` keeps opacity modifiers (`bg-accent/10`) working on top of
      // CSS variables, so themes switch without duplicating hex values.
      colors: {
        ...Object.fromEntries(
          COLOR_TOKENS.map((token) => [
            token,
            `color-mix(in srgb, var(--aulora-${token}) calc(<alpha-value> * 100%), transparent)`,
          ]),
        ),
        idle: IDLE_COLOR,
      },
      keyframes: {
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.45" },
          "30%": { transform: "translateY(-3px)", opacity: "1" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "message-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
        "fade-in": "fade-in 140ms ease-out",
        "pop-in": "pop-in 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2)",
        "slide-in-right": "slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "message-in": "message-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 140ms ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ":root": cssVariables("light"), ".dark": cssVariables("dark") });
    }),
  ],
};

export default config;
