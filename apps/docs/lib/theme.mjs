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

function quoteFamily(name) {
  return /^[a-z-]+$/.test(name) ? name : `"${name}"`;
}

/**
 * `@font-face` rules and `--font-sans`/`--font-mono` from
 * `packages/tokens/src/font-data.json`, the same data the app's Tailwind preset
 * reads. `dir` is the font directory relative to the generated stylesheet.
 */
export function fontCss(fonts, dir) {
  const faces = fonts.web.map(
    (face) => `@font-face {
  font-family: ${quoteFamily(fonts.families[face.family].name)};
  font-style: ${face.style};
  font-weight: ${face.weight};
  font-display: swap;
  src: url("${dir}/${face.file}") format("woff2");
  unicode-range: ${face.unicodeRange};
}`,
  );
  const fallbacks = Object.values(fonts.families).map(
    ({ fallback }) => `@font-face {
  font-family: ${quoteFamily(fallback.name)};
  src: ${fallback.local.map((name) => `local("${name}")`).join(", ")};
  size-adjust: ${fallback.sizeAdjust};
  ascent-override: ${fallback.ascentOverride};
  descent-override: ${fallback.descentOverride};
  line-gap-override: ${fallback.lineGapOverride};
}`,
  );
  const stack = (token) => {
    const family = fonts.families[token];
    return [family.name, family.fallback.name, ...family.generic].map(quoteFamily).join(", ");
  };
  return `/* Generated from packages/tokens/src/font-data.json by scripts/build.mjs. */
${[...faces, ...fallbacks].join("\n\n")}

:root {
  --font-sans: ${stack("sans")};
  --font-mono: ${stack("mono")};
}
`;
}

/** The font files a page should preload: the Latin UI face. */
export function preloadFonts(fonts) {
  return fonts.web.filter((face) => face.preload).map((face) => face.file);
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
