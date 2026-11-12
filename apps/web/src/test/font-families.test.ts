import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emailFontStack, preloadFontFiles } from "@aulora/tokens";
import { describe, expect, it } from "vitest";
import fontData from "../../../../packages/tokens/src/font-data.json";

/**
 * Every surface draws the faces declared in `packages/tokens/src/font-data.json`.
 * A font-family literal anywhere else would let one surface drift back to a
 * per-OS system face (and its own metrics), so sources are scanned for one.
 */
const sources = import.meta.glob(
  [
    "../**/*.{ts,tsx,css}",
    "!../test/**",
    "../../index.html",
    "../../tailwind.config.ts",
    "../../../../packages/{ui-web,ui-native,core,avatars}/src/**/*.{ts,tsx,css}",
    "../../../../packages/tokens/src/*.ts",
    "../../../mobile/{app,src}/**/*.{ts,tsx}",
    "../../../mobile/{global.css,tailwind.config.ts}",
    "../../../docs/{static,lib,scripts}/*.{js,mjs,css}",
    "../../../docs/landing/*.html",
    "../../../../scripts/store-assets/*.html",
    "../../../../packages/convex/convex/**/*.ts",
    "!**/_generated/**",
    "!**/*.test.*",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** Family names that only belong in the token data (or the email fallback below). */
const familyNames = Object.values(fontData.families).flatMap((family) => [
  family.name,
  family.fallback.name,
  ...family.fallback.local,
  ...family.generic,
  ...family.email,
]);

/** The family name that starts earliest in `text` (the first listed wins a tie). */
function firstFamilyName(text: string): string | undefined {
  let found: { readonly name: string; readonly index: number } | undefined;
  for (const name of familyNames) {
    const index = text.indexOf(name);
    if (index !== -1 && (found === undefined || index < found.index)) found = { name, index };
  }
  return found?.name;
}
/**
 * A CSS `font-family` whose value is not a token variable (or a generated
 * `${…}`). `\s*` spans newlines, so a declaration wrapped onto the next line
 * is still read.
 */
const CSS_FAMILY = /font-family:\s*(?!\s|var\(--font-(?:sans|mono)\)|inherit|\$\{)([^;"`}]+)/g;
/** A React Native `fontFamily` given a string literal instead of a token helper. */
const RN_FAMILY = /fontFamily:\s*["'`]/g;
/** A family name close after a `font-family`/`fontFamily` key, even across a wrap. */
const FAMILY_KEY = /font(?:Family|-family)/g;
const KEY_REACH = 160;

/** Files allowed to spell out a family, each with the exact value it must hold. */
const EXACT: Record<string, string[]> = {
  // Email clients cannot load web fonts or the metric fallback face.
  "../../../../packages/convex/convex/lib/inviteEmail.ts": [
    `font-family:${emailFontStack("sans")};`,
  ],
  // A standalone page rendered to PNG; it loads the vendored Inter itself.
  "../../../../scripts/store-assets/feature-graphic.html": [
    `font-family: ${fontData.families.sans.name};`,
    `font-family: ${fontData.families.sans.name}, ${fontData.families.sans.generic.at(-1)};`,
  ],
};

const blank = (text: string) => text.replace(/[^\n]/g, " ");
const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/** Strays in one source file; positions survive comment and exact-value removal. */
function findStrays(path: string, rawSource: string): string[] {
  const source = rawSource.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, blank);
  const exact = EXACT[path];
  const text =
    exact === undefined
      ? source
      : exact.reduce((acc, value) => acc.replaceAll(value, blank(value)), source);
  const strays: string[] = [];
  if (exact !== undefined && text === source) strays.push(`${path}: expected ${exact.join(" | ")}`);
  const seen = new Set<number>();
  const report = (offset: number, snippet: string) => {
    const line = lineOf(text, offset);
    if (seen.has(line)) return;
    seen.add(line);
    strays.push(`${path}:${line}: ${snippet.trim()}`);
  };
  for (const match of text.matchAll(CSS_FAMILY)) report(match.index, match[0]);
  for (const match of text.matchAll(RN_FAMILY)) report(match.index, match[0]);
  for (const key of text.matchAll(FAMILY_KEY)) {
    const reach = text.slice(key.index, key.index + KEY_REACH).split(/[;}]/)[0] ?? "";
    const named = firstFamilyName(reach);
    if (named !== undefined) report(key.index, named);
  }
  return strays;
}

describe("font families", () => {
  it("scans the web, desktop, docs, mobile, email and store-asset sources", () => {
    const paths = Object.keys(sources);
    for (const marker of [
      "../../index.html",
      "../../../../packages/ui-web/src/Button.tsx",
      "../../../../packages/ui-native/src/Text.tsx",
      "../../../mobile/app/_layout.tsx",
      "../../../docs/static/site.css",
      "../../../docs/landing/index.html",
      "../../../../packages/convex/convex/lib/inviteEmail.ts",
      "../../../../scripts/store-assets/feature-graphic.html",
    ]) {
      expect(paths).toContain(marker);
    }
    expect(paths.length).toBeGreaterThan(300);
  });

  it("keeps font-family literals in @aulora/tokens only", () => {
    const strays: string[] = [];
    for (const [path, source] of Object.entries(sources)) strays.push(...findStrays(path, source));
    expect(strays).toEqual([]);
  });

  it("catches a font-family declaration wrapped onto the next line", () => {
    const wrapped = ["a {", "  font-family:", '    "Helvetica Neue", sans-serif;', "}"].join("\n");
    expect(findStrays("x.css", wrapped)).toHaveLength(1);
    expect(findStrays("x.css", "a {\n  font-family:\n    var(--font-sans);\n}")).toEqual([]);
    expect(findStrays("x.ts", "const s = {\n  fontFamily:\n    'Menlo',\n};")).toHaveLength(1);
    expect(findStrays("x.ts", "const s = {\n  fontFamily:\n    nativeFontFamily(a),\n};")).toEqual(
      [],
    );
  });

  it("preloads the Latin Inter face the stylesheet declares", () => {
    const html = sources["../../index.html"] ?? "";
    expect(preloadFontFiles).toEqual(["inter-latin-wght-normal.woff2"]);
    for (const file of preloadFontFiles) {
      expect(html).toContain(`href="../../packages/tokens/fonts/web/${file}"`);
    }
    expect(html).toMatch(
      /rel="preload"[\s\S]*as="font"[\s\S]*type="font\/woff2"[\s\S]*crossorigin/,
    );
  });
});

it("matches every vendored font to its documented SHA-256", () => {
  const root = pathToFileURL(`${resolve(process.cwd(), "../../packages/tokens/fonts")}/`);
  const readme = readFileSync(new URL("README.md", root), "utf8");
  const entries = [...readme.matchAll(/\| `([^`]+\.(?:ttf|woff2))` \| `([a-f0-9]{64})` \|/g)];
  const files = ["web", "native"].flatMap((dir) =>
    readdirSync(new URL(`${dir}/`, root))
      .filter((file) => /\.(ttf|woff2)$/.test(file))
      .map((file) => `${dir}/${file}`),
  );
  expect(entries.map((entry) => entry[1]).sort()).toEqual(files.sort());
  for (const [, file, checksum] of entries) {
    expect(
      createHash("sha256")
        .update(readFileSync(new URL(file ?? "", root)))
        .digest("hex"),
      file,
    ).toBe(checksum);
  }
});
