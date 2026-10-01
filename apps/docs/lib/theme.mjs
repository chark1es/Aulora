// Reads the app's design tokens and icon set straight from `@aulora/tokens`
// sources, so the docs site and landing page use the exact palette and glyphs
// the clients ship. The token package is TypeScript; rather than adding a
// compiler, these helpers parse the two literal shapes it exports.

import { escapeHtml } from "./markdown.mjs";

function objectBody(source, name) {
  const start = source.indexOf(`export const ${name} = {`);
  if (start === -1) {
    throw new Error(`tokens: could not find ${name}`);
  }
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

function palette(source, name) {
  const entries = [
    ...objectBody(source, name).matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"(#[0-9A-Fa-f]+)"/gm),
  ];
  if (entries.length === 0) {
    throw new Error(`tokens: ${name} has no colors`);
  }
  return Object.fromEntries(entries.map((match) => [match[1], match[2]]));
}

/** Parses `colors.ts` into `{ dark, light, idle }` palettes. */
export function readPalettes(source) {
  const idle = /export const IDLE_COLOR = "(#[0-9A-Fa-f]+)"/.exec(source);
  return {
    dark: palette(source, "darkPalette"),
    light: palette(source, "lightPalette"),
    idle: idle ? idle[1] : null,
  };
}

function declarations(colors, indent) {
  return Object.entries(colors)
    .map(([token, value]) => `${indent}--${token}: ${value};`)
    .join("\n");
}

/**
 * CSS custom properties for both themes. The site follows the system
 * appearance only; it deliberately has no appearance switch of its own.
 */
export function paletteCss({ dark, light, idle }) {
  const shared = idle ? `\n  --idle: ${idle};` : "";
  return `/* Generated from packages/tokens/src/colors.ts by scripts/build.mjs. */
:root {
${declarations(light, "  ")}${shared}
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
${declarations(dark, "    ")}
  }
}
`;
}

/** Parses `icons.ts` into a map of icon name to SVG path data. */
export function readIcons(source) {
  const icons = {};
  for (const match of source.matchAll(/^ {2}"?([a-z-]+)"?: \[\n((?:\s+"[^"]*",\n)+)\s+\],/gm)) {
    icons[match[1]] = [...match[2].matchAll(/"([^"]*)"/g)].map((path) => path[1]);
  }
  return icons;
}

/** A decorative inline icon drawn in `currentColor`, like `@aulora/ui-web`'s Icon. */
export function iconSvg(icons, name, className = "icon") {
  const paths = icons[name];
  if (paths === undefined) {
    throw new Error(`tokens: unknown icon "${name}"`);
  }
  const body = paths.map((d) => `<path fill="currentColor" d="${escapeHtml(d)}"/>`).join("");
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}
