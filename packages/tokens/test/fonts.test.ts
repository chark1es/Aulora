import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emailFontStack,
  fontFaceRules,
  fontFamilies,
  fontMetrics,
  fontStack,
  nativeFontFamilies,
  nativeFontFamily,
  nativeFontWeight,
  nativewindPreset,
  preloadFontFiles,
  tailwindPreset,
  webFontFaces,
} from "../src/index";

const root = new URL("../../../", import.meta.url);
const fontDir = new URL("packages/tokens/fonts/", root);

describe("shipped typefaces", () => {
  it("lead every web stack with the self-hosted face and its metric fallback", () => {
    expect(fontFamilies.sans).toEqual([
      '"Inter"',
      '"Inter Fallback"',
      "ui-sans-serif",
      "system-ui",
      "sans-serif",
    ]);
    expect(fontStack("mono")).toBe(
      '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace',
    );
    expect(emailFontStack("sans")).toBe(
      "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    );
  });

  it("vendors every declared file with its OFL licence", () => {
    for (const face of webFontFaces) {
      expect(existsSync(new URL(`web/${face.file}`, fontDir)), face.file).toBe(true);
    }
    const native = [
      ...Object.values(nativeFontFamilies.sans),
      ...Object.values(nativeFontFamilies.mono),
    ];
    for (const name of native) {
      expect(existsSync(new URL(`native/${name}.ttf`, fontDir)), name).toBe(true);
    }
    for (const licence of ["licenses/inter-OFL.txt", "licenses/jetbrains-mono-OFL.txt"]) {
      expect(readFileSync(new URL(licence, root), "utf8")).toContain("SIL Open Font License");
    }
  });

  it("keeps Inter's cap band centred in its line box", () => {
    const { ascender, descender, capHeight } = fontMetrics.sans;
    expect(ascender - capHeight).toBe(-descender);
  });

  it("covers Latin and Latin Extended, preloading only the Latin UI face", () => {
    expect(new Set(webFontFaces.map((face) => face.unicodeRange)).size).toBe(2);
    expect(preloadFontFiles).toEqual(["inter-latin-wght-normal.woff2"]);
  });

  it("emits swap faces and size-adjusted local fallbacks", () => {
    const rules = fontFaceRules((file) => `/fonts/${file}`);
    const inter = rules.find(
      (rule) => rule.src === 'url("/fonts/inter-latin-wght-normal.woff2") format("woff2")',
    );
    expect(inter).toMatchObject({
      fontFamily: '"Inter"',
      fontDisplay: "swap",
      fontWeight: "100 900",
    });
    const fallback = rules.find((rule) => rule.fontFamily === '"Inter Fallback"');
    expect(fallback?.src).toContain('local("Arial")');
    expect(fallback).toMatchObject({
      sizeAdjust: "107.34%",
      ascentOverride: "90.25%",
      lineGapOverride: "0%",
    });
  });
});

describe("native faces", () => {
  it("maps any React Native weight to the nearest shipped static file", () => {
    expect(nativeFontWeight(undefined)).toBe(400);
    expect(nativeFontWeight("normal")).toBe(400);
    expect(nativeFontWeight("500")).toBe(500);
    expect(nativeFontWeight(600)).toBe(600);
    expect(nativeFontWeight("bold")).toBe(700);
    expect(nativeFontWeight("900")).toBe(700);
    expect(nativeFontWeight("300")).toBe(400);
    expect(nativeFontFamily("600")).toBe("Inter-SemiBold");
    expect(nativeFontFamily("700", "sans", true)).toBe("Inter-Italic");
    expect(nativeFontFamily("700", "mono")).toBe("JetBrainsMono-Regular");
  });

  it("gives NativeWind the registered files and weight-aware utilities", () => {
    expect(nativewindPreset.theme.extend.fontFamily.mono).toEqual(["JetBrainsMono-Regular"]);
    expect(tailwindPreset.plugins).toEqual([]);
    const utilities: Record<string, Record<string, string>> = {};
    for (const plugin of nativewindPreset.plugins) {
      plugin({ addUtilities: (added) => Object.assign(utilities, added) });
    }
    expect(utilities[".font-semibold"]).toEqual({ "font-family": "Inter-SemiBold" });
    expect(utilities[".font-normal"]).toEqual({ "font-family": "Inter-Regular" });
    expect(utilities[".font-black"]).toEqual({ "font-family": "Inter-Bold" });
  });
});

describe("docs site font generator", () => {
  // The docs build is plain Node and cannot import this TypeScript package, so
  // `apps/docs/lib/theme.mjs` re-implements the generator. Pin the two together.
  type FontData = unknown;
  const themeUrl = new URL("apps/docs/lib/theme.mjs", root).href;

  async function docsCss(): Promise<string> {
    const theme = (await import(/* @vite-ignore */ themeUrl)) as {
      fontCss: (fonts: FontData, dir: string) => string;
    };
    const data = JSON.parse(
      readFileSync(new URL("packages/tokens/src/font-data.json", root), "utf8"),
    );
    return theme.fontCss(data, "fonts");
  }

  const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  it("emits the same @font-face rules as fontFaceRules", async () => {
    const css = await docsCss();
    const docsRules = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body]) =>
      Object.fromEntries(
        [...(body ?? "").matchAll(/^\s*([a-z-]+):\s*(.+);$/gm)].map((m) => [m[1], m[2]]),
      ),
    );
    const tokenRules = fontFaceRules((file) => `fonts/${file}`).map((rule) =>
      Object.fromEntries(Object.entries(rule).map(([key, value]) => [kebab(key), String(value)])),
    );
    expect(docsRules.length).toBeGreaterThan(0);
    expect(docsRules).toEqual(tokenRules);
  });

  it("emits the same font stacks as fontStack", async () => {
    const css = await docsCss();
    expect(css).toContain(`--font-sans: ${fontStack("sans")};`);
    expect(css).toContain(`--font-mono: ${fontStack("mono")};`);
  });
});
