import fonts from "./font-data.json";
import type { Fn } from "./function-type";

/**
 * Aulora ships one typeface on every surface: Inter (SIL OFL 1.1) for UI text
 * and JetBrains Mono (SIL OFL 1.1) for code. Both are self-hosted from
 * `packages/tokens/fonts`, so the web app, desktop shell, docs site and the
 * iOS/Android apps draw the same glyphs with the same metrics.
 *
 * Inter's vertical metrics put the cap band exactly in the middle of its line
 * box (ascender − cap height = |descender| = 494 units), so a label that is
 * centered as a line box is optically centered too. Controls therefore need
 * no per-platform or runtime ink correction.
 *
 * The web files are the `wght`-only variable cut, which renders the 14pt
 * "text" optical size. The native statics are the same 14pt instances, so
 * optical sizing is intentionally fixed rather than `auto` on any surface.
 */
export type FontFamilyToken = keyof typeof fonts.families;

/** Font-face metadata from `font-data.json`, typed for consumers. */
export interface WebFontFace {
  readonly family: FontFamilyToken;
  readonly file: string;
  readonly style: "normal" | "italic";
  readonly weight: string;
  readonly preload: boolean;
  readonly unicodeRange: string;
}

const FAMILY_TOKENS = ["sans", "mono"] as const satisfies readonly FontFamilyToken[];

function quote(name: string): string {
  return /^[a-z-]+$/.test(name) ? name : `"${name}"`;
}

/** The family record for a token (a switch, so no dynamic property lookup). */
function familyOf(token: FontFamilyToken) {
  switch (token) {
    case "mono":
      return fonts.families.mono;
    case "sans":
      return fonts.families.sans;
  }
}

function webStack(token: FontFamilyToken): readonly string[] {
  const family = familyOf(token);
  return [family.name, family.fallback.name, ...family.generic].map(quote);
}

/** CSS `font-family` lists for web surfaces: shipped face, metric-matched fallback, generics. */
export const fontFamilies = {
  sans: webStack("sans"),
  mono: webStack("mono"),
} as const satisfies Record<FontFamilyToken, readonly string[]>;

/** One `font-family` value, e.g. for a CSS custom property. */
export function fontStack(token: FontFamilyToken): string {
  return webStack(token).join(", ");
}

/**
 * Email clients cannot load web fonts reliably and never see the metric-matched
 * fallback face, so email leads with Inter and falls back to installed faces.
 */
export function emailFontStack(token: FontFamilyToken): string {
  const family = familyOf(token);
  return [family.name, ...family.email]
    .map((name) => (name.includes(" ") ? `'${name}'` : name))
    .join(",");
}

/** Self-hosted web faces in `packages/tokens/fonts/web`. */
export const webFontFaces: readonly WebFontFace[] = fonts.web.map((face) => ({
  ...face,
  family: face.family as FontFamilyToken,
  style: face.style === "italic" ? "italic" : "normal",
}));

/** The file each web page should `<link rel="preload">`: the Latin UI face. */
export const preloadFontFiles: readonly string[] = webFontFaces
  .filter((face) => face.preload)
  .map((face) => face.file);

type FontFaceRule = Record<string, string>;

/**
 * `@font-face` rules for the shipped faces plus their metric-matched local
 * fallbacks. `urlFor` maps a file name to the URL the bundler can resolve.
 * The fallback faces scale an installed sans or mono face (listed in
 * font-data.json) so the swap from fallback to
 * Inter/JetBrains Mono does not shift layout.
 */
export function fontFaceRules(urlFor: Fn<[file: string], string>): FontFaceRule[] {
  const faces = webFontFaces.map((face) => ({
    fontFamily: quote(familyOf(face.family).name),
    fontStyle: face.style,
    fontWeight: face.weight,
    fontDisplay: "swap",
    src: `url("${urlFor(face.file)}") format("woff2")`,
    unicodeRange: face.unicodeRange,
  }));
  const fallbacks = FAMILY_TOKENS.map((token) => {
    const { fallback } = familyOf(token);
    return {
      fontFamily: quote(fallback.name),
      src: fallback.local.map((name) => `local("${name}")`).join(", "),
      sizeAdjust: fallback.sizeAdjust,
      ascentOverride: fallback.ascentOverride,
      descentOverride: fallback.descentOverride,
      lineGapOverride: fallback.lineGapOverride,
    };
  });
  return [...faces, ...fallbacks];
}

/** Native weights that have a shipped static face. */
export type NativeFontWeight = 400 | 500 | 600 | 700;

/**
 * React Native needs one registered family name per static file. The names
 * equal each file's PostScript name, which is also what iOS resolves.
 */
export const nativeFontFamilies = {
  sans: {
    400: fonts.native.sans["400"],
    500: fonts.native.sans["500"],
    600: fonts.native.sans["600"],
    700: fonts.native.sans["700"],
    italic: fonts.native.sans.italic,
  },
  mono: { 400: fonts.native.mono["400"] },
} as const;

const NAMED_WEIGHTS = new Map<string, number>([
  ["normal", 400],
  ["bold", 700],
]);

/** Nearest shipped native weight for any RN `fontWeight` value. */
export function nativeFontWeight(weight: string | number | undefined): NativeFontWeight {
  const numeric =
    typeof weight === "number"
      ? weight
      : weight === undefined
        ? 400
        : (NAMED_WEIGHTS.get(weight) ?? Number.parseInt(weight, 10));
  if (!Number.isFinite(numeric) || numeric < 450) return 400;
  if (numeric < 550) return 500;
  if (numeric < 650) return 600;
  return 700;
}

/**
 * The registered native family for a weight, e.g. `Inter-SemiBold` for 600.
 * Italic ships as one Regular Italic face, used for emphasis in message and
 * note text at any weight.
 */
export function nativeFontFamily(
  weight: string | number | undefined,
  token: FontFamilyToken = "sans",
  italic = false,
): string {
  switch (token) {
    case "mono":
      return nativeFontFamilies.mono[400];
    case "sans":
      return italic
        ? nativeFontFamilies.sans.italic
        : nativeFontFamilies.sans[nativeFontWeight(weight)];
  }
}

/**
 * Feature settings. Counts, timestamps and durations use tabular figures so
 * they do not jitter as they tick. Inter's character variants (cv11, ss03) are
 * not present in the subset web files, so none are enabled: every surface
 * draws the default glyphs.
 */
export const fontFeatures = {
  tabularNumbers: "tabular-nums",
} as const;

/** Raw font metrics (font units), used by tests and layout math. */
export const fontMetrics = fonts.metrics;
