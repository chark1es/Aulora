# Aulora typefaces

Aulora uses one sans family and one mono family on every surface:

| Role | Family | Licence |
| --- | --- | --- |
| Interface text | [Inter](https://github.com/rsms/inter) 4.001 | SIL OFL 1.1 ([`licenses/inter-OFL.txt`](../../../licenses/inter-OFL.txt)) |
| Code, IDs, logs | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) 2.211 | SIL OFL 1.1 ([`licenses/jetbrains-mono-OFL.txt`](../../../licenses/jetbrains-mono-OFL.txt)) |

Inter is a screen-first UI family with tabular figures, wide language
coverage and a large x-height that stays legible at 11–13px. Its vertical
metrics also make controls easy to centre: ascender − cap height equals the
descender (1984 − 1490 = 494 units), so the cap band sits in the exact middle
of its line box.

Before this, the stack was a per-OS fallback list (SF Pro, Segoe UI, Inter or
Geist where installed, then `system-ui`), so each platform drew a different
face with different metrics and no static alignment could fit all of them.

## Where each surface gets the faces

`src/font-data.json` is the only place family names are written. Everything
else derives from it, and `apps/web/src/test/font-families.test.ts` fails if
a `font-family` literal appears anywhere else.

| Surface | How |
| --- | --- |
| Web app and desktop shell | `apps/web/tailwind.config.ts` emits `@font-face` from `fontFaceRules()`; Vite fingerprints the files into `/assets`. `index.html` preloads the Latin Inter file. |
| Docs and landing site | `apps/docs/scripts/build.mjs` copies `web/` to `dist/fonts` and writes `@font-face`, `--font-sans` and `--font-mono` into `tokens.css`. Pages preload the Latin Inter file. |
| iOS and Android | `apps/mobile/src/lib/fonts.ts` loads `native/` with `expo-font`; the root layout holds the splash until they are registered. `@aulora/ui-native` maps each weight to its file (`Inter-SemiBold` for 600, and so on). |
| Email | `emailFontStack()`: Inter first, then installed faces, because mail clients do not load web fonts. |
| Store graphics | `scripts/store-assets/feature-graphic.html` loads `web/inter-latin-wght-normal.woff2` directly. |

Web faces use `font-display: swap` with an `Inter Fallback` face: a local
Arial (or Liberation Sans/Helvetica) scaled with `size-adjust: 107.34%`,
`ascent-override: 90.25%`, `descent-override: 22.47%` and
`line-gap-override: 0%`, computed from both fonts' metrics, so text keeps its
width and line height when Inter arrives.

Counts and timestamps use `tabular-nums` (`fontFeatures.tabularNumbers`).
Inter's character variants (cv11, ss03) are not in the subset web files, so
none are enabled anywhere. The web files are the `wght`-only variable cut and
the native files are static instances at the same 14pt optical size, so
optical sizing is fixed rather than `auto`.

## Centring text in controls

Because every surface draws the same face, centring is static CSS and layout
rules; there is no runtime measuring.

- Labels in fixed-height controls (`Button`, `Badge`, `SegmentedControl`, tabs
  and count badges) are wrapped by `CapText` from `@aulora/ui-web`, which sets
  `text-box: trim-both cap alphabetic`. The label's box becomes the cap band,
  so `items-center` centres the letters. The docs site does the same for
  `.button > .label`, `.badge` and `.beta`.
- Single-line inputs ignore `line-height` and centre Inter's font box (17px at
  14px text), so `Input` and `SearchInput` at `md` take 1px of bottom padding
  to put the baseline on a whole pixel. `Textarea` uses a 20px line height and
  the `Select` trigger a 16px one for the same reason.
- Buttons with a leading icon take 2px less start padding to balance the blank
  edges in Material Symbols' 24px grid.
- React Native centres the font box inside `lineHeight` on both platforms, and
  `includeFontPadding: false` removes Android's extra padding, so native text
  needs no per-platform nudge.

Engines without `text-box` (Firefox, older WebKit) fall back to Inter's own
line box, which is centred to within the ascent and descent rounding.

## Files and provenance

| File | Bytes | Source |
| --- | ---: | --- |
| `web/inter-latin-wght-normal.woff2` | 48256 | `@fontsource-variable/inter@5.3.0` |
| `web/inter-latin-wght-italic.woff2` | 51832 | `@fontsource-variable/inter@5.3.0` |
| `web/inter-latin-ext-wght-normal.woff2` | 85068 | `@fontsource-variable/inter@5.3.0` |
| `web/inter-latin-ext-wght-italic.woff2` | 91900 | `@fontsource-variable/inter@5.3.0` |
| `web/jetbrains-mono-latin-wght-normal.woff2` | 40404 | `@fontsource-variable/jetbrains-mono@5.3.0` |
| `web/jetbrains-mono-latin-ext-wght-normal.woff2` | 15196 | `@fontsource-variable/jetbrains-mono@5.3.0` |
| `native/Inter-{Regular,Medium,SemiBold,Bold,Italic}.ttf` | ~177 KB each | `@expo-google-fonts/inter@0.4.2`, subset |
| `native/JetBrainsMono-Regular.ttf` | 65612 | `@expo-google-fonts/jetbrains-mono@0.4.1`, subset |

The web files are copied unchanged from the npm tarballs. The native files are
the static Google Fonts builds (same Inter 4.001 / JetBrains Mono 2.211
sources as the web files, identical vertical metrics), subset with fontTools
to the same Latin and Latin Extended `unicode-range`s as the web files, so
every platform covers the same characters and falls back for the same ones:

```sh
pyftsubset Inter_400Regular.ttf --output-file=Inter-Regular.ttf \
  --unicodes="$(jq -r '[.web[0,2].unicodeRange] | join(",")' ../src/font-data.json)" \
  --layout-features='*' --name-IDs='*' --name-languages='*' --notdef-outline --hinting
```

Each file's PostScript name equals its file name (`Inter-SemiBold`), which is
the family name React Native resolves on both platforms.

JetBrains Mono ships natively at 400 only. Web uses the `wght` variable file,
so bold code renders bold there, but on iOS and Android a mono node always
draws Regular: `nativeFontFamily("mono")` has no other file, the rich-text
renderer pins code spans inside `**bold**` to weight 400, and
`scanMonoWeights` (`packages/ui-native/test/font-scan.ts`) fails if a
component combines mono with a heavier weight. Shipping `JetBrainsMono-Bold`
would need the 700 static build from `@expo-google-fonts/jetbrains-mono`, the
same subset step, a `font-data.json` entry, an `expo-font` registration and a
new checksum row below.

To update a face, replace the files, update the table and `font-data.json`
(fallback overrides included), and rerun the token, web, docs and mobile tests.

## SHA-256 checksums

| File | SHA-256 |
| --- | --- |
| `native/Inter-Bold.ttf` | `339ad94ec7123a197dad4e29afff9b1e102b4ffb6be90f801ee222f0c8e06858` |
| `native/Inter-Italic.ttf` | `c7456bbc897541b9a8c4e15d1c00f5b39290d1a876e36ead8dd05dc5f42c3bb4` |
| `native/Inter-Medium.ttf` | `246adb053beed068bc4f16f25f8a972b77b0afbeb9c8c7d5d878cd8600393930` |
| `native/Inter-Regular.ttf` | `e115495814ea5525db332c4ac79dcd002bd4b5dbccda641338448d2a43a986b1` |
| `native/Inter-SemiBold.ttf` | `9b92e79ebfb58c9bc6dd7bec79f8ff3263c278395db9897e0a233dea675a429a` |
| `native/JetBrainsMono-Regular.ttf` | `69661e76fac015a062177a68d75ca447d807314a615811de94b38725fc236fca` |
| `web/inter-latin-ext-wght-italic.woff2` | `71254244ccb1ec21e14db3480fef6f6826d1136dc4aca1c7d3ca7ce31294fcce` |
| `web/inter-latin-ext-wght-normal.woff2` | `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956` |
| `web/inter-latin-wght-italic.woff2` | `7291b5970da2237441273c03b424a504b70b18f09791473fab99687dcc314720` |
| `web/inter-latin-wght-normal.woff2` | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `web/jetbrains-mono-latin-ext-wght-normal.woff2` | `79bfdab9ba467e26eea4122e6f2567e188dd8a09a8c730d501fc487c4ab99c6e` |
| `web/jetbrains-mono-latin-wght-normal.woff2` | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` |
