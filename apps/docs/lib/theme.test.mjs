import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { iconSvg, paletteCss, readIcons, readPalettes } from "./theme.mjs";

const tokens = new URL("../../../packages/tokens/src/", import.meta.url);
const colorsSource = readFileSync(new URL("colors.ts", tokens), "utf8");
const iconsSource = readFileSync(new URL("icons.ts", tokens), "utf8");

test("readPalettes reads every token of both themes from @aulora/tokens", () => {
  const { dark, light, idle } = readPalettes(colorsSource);
  const expected = [...colorsSource.matchAll(/^ {2}"?([a-z0-9-]+)"?,$/gm)].map((m) => m[1]);
  assert.ok(expected.length > 0);
  assert.deepEqual(Object.keys(dark), expected);
  assert.deepEqual(Object.keys(light), expected);
  assert.match(dark.accent, /^#[0-9A-F]{6}$/i);
  assert.notEqual(dark.bg, light.bg);
  assert.match(idle, /^#/);
});

test("paletteCss emits light defaults and a system dark theme", () => {
  const css = paletteCss({ dark: { bg: "#000000" }, light: { bg: "#ffffff" }, idle: "#aaaaaa" });
  assert.match(css, /:root \{\n {2}--bg: #ffffff;\n {2}--idle: #aaaaaa;/);
  assert.match(css, /prefers-color-scheme: dark\) \{\n {2}:root \{\n {4}--bg: #000000;/);
  assert.doesNotMatch(css, /data-theme/);
});

test("readIcons parses every generated icon", () => {
  const icons = readIcons(iconsSource);
  const declared = iconsSource.match(/^ {2}"?[a-z-]+"?: \[$/gm) ?? [];
  assert.equal(Object.keys(icons).length, declared.length);
  assert.ok(icons.hash[0].startsWith("m9 16"));
});

test("iconSvg renders a decorative currentColor icon and rejects unknown names", () => {
  const svg = iconSvg({ dot: ['M0 0"h1'] }, "dot");
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /fill="currentColor" d="M0 0&quot;h1"/);
  assert.throws(() => iconSvg({}, "missing"), /unknown icon/);
});
