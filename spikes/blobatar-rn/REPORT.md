# Spike C — Avatar strategy (blobatar + react-native-svg)

**Date:** 2026-09-25 · **Env:** Windows 10, PowerShell 5.1, Node v22.18.0, npm 10.2.4
**Scope:** `spikes/blobatar-rn/` only. Nothing committed.

## Verdict

**blobatar is real, maintained, and usable.** The spec's core claim holds: `blobatar`'s
core exports a plain function returning a full raw `<svg>` string, and that string is
accepted by `react-native-svg`'s real parser and mounts as a real `RNSVG*` element tree.
Web rendering via `@blobatar/react` + `react-dom/server` also works.

**Recommended stack:**
- Web: `@blobatar/react@2.7.0` (+ `blobatar@2.7.0` peer)
- Native: `blobatar@2.7.0` string API → `react-native-svg@15.15.5` `<SvgXml>`
- Seed: stable user id string (e.g. `aulora:user:<uuid>`)

An official `@blobatar/react-native@2.7.0` adapter also exists (see below) — use it only if
you want animated/morphing avatars on device.

## 1. Existence + metadata (npm registry)

| Package | Version | License | Runtime deps | Published | Repository / dist-tags |
|---|---|---|---|---|---|
| `blobatar` | 2.7.0 | MIT | **none** | 2026-08-29 | github.com/Alain00/blobatar · latest=2.7.0 (12 versions) |
| `@blobatar/react` | 2.7.0 | MIT | **none** | 2026-08-29 | same monorepo (`packages/react`) · latest=2.7.0 (7 versions) |
| `react-native-svg` | 15.15.5 | MIT | css-select, css-tree | — | software-mansion · peer `react`, `react-native` |
| `@blobatar/react-native` | 2.7.0 | MIT | none (peers only) | 2026-08-29 | same monorepo (`packages/react-native`) |
| `react` / `react-dom` / `react-test-renderer` | 19.3.0 | MIT | scheduler etc. | — | — |

Both packages carry **SLSA provenance** attestations published by GitHub Actions from the
`Alain00/blobatar` repo. `blobatar` first appeared 2026-08-16, i.e. it is ~6 weeks old with a
single maintainer (`alain00`). `@blobatar/react` is a thin re-export of the component that
still lives in `blobatar/react`; `blobatar/react` is marked **deprecated, frozen, removed in v3**.

Candidate alternatives — registry metadata only (not installed, because blobatar satisfied
every goal):

| Candidate | Version | License | Note |
|---|---|---|---|
| `boring-avatars` | 2.0.4 | MIT | React component; last modified 2025-09-28; no confirmed raw-string API |
| `@dicebear/core` | 10.7.0 | MIT | Renders SVG string; per-style packages are separate deps |
| `@dicebear/collection` | 9.4.2 | MIT | 30+ per-style deps — heaviest option |
| `minidenticons` | 4.2.1 | MIT | Tiny, returns SVG string |
| `jdenticon` | 3.3.0 | MIT | depends on `canvas-renderer` — the only non-zero-dep candidate |

## 2. API surface (installed, inspected via `src/inspect-exports.mjs`)

`blobatar` (ESM-only, `"type":"module"`, `main: ./dist/index.js`) exports:
`blobatar`, `_layout`, `contrast`, `normalizeSeed`, `palette`, `ramp`, `traits`, `FLOORS`, `VERSION`.

- **`blobatar(name: string, opts?) => string`** — returns a complete
  `<svg xmlns=… viewBox="0 0 100 100">…</svg>` string. This is the mobile payload.
  Example seed `aulora:user:8f3a1c` → 719-char SVG, 7 geometry nodes.
- `blobatarUri(name, opts?) => string` — percent-encoded `data:image/svg+xml,…` (623–763 chars).
- `blobatar/expression` — `happy, love, sad, mad, scared, shy, sick, sleepy, smug, surprised,
  thinking, unsure, wink, idle, …` (usable statically, baked into geometry).
- `blobatar/internal` — `_marks` / `_posed` / `_parts`: drawing primitives "for a renderer with
  no markup to hand a string to… where the substrate is react-native-svg". A documented
  lower-level escape hatch if you ever want native primitives instead of string parsing.
- Options: `size`, `background`, `palette`, `hue`, `tone`, `traits`, `normalize` (default true;
  NFC + trim + lowercase), `contrast`, `title`, `animate` (`"hover" | "always"`, adapters only),
  `expression`.

`@blobatar/react` exports a single `Blobatar` component. Static mode emits an
`<img src="data:image/svg+xml,…">`; `animate` switches to inline `<svg>`. Props include
`name` (required), `size`, `animate`, plus the core options.

## 3. Rendering proof

Run: `npm run verify` (web → native → seed). Captured output: `evidence/verify-output.txt`.
All 20 assertions pass, exit code 0.

**Web (`react-dom/server.renderToString`, React 19.3.0):**
- core string → full `<svg>`, 7 geometry nodes, `sha256=2034fd25`.
- static `Blobatar` → 979-char `<img src="data:image/svg+xml,…">`.
- `animate="always"` → 1259-char inline `<svg>` with 12 geometry nodes and per-seed CSS vars
  (`--mo-phase:-1302ms;--mo-bob-phase:-500ms;…`).

**Native (`react-native-svg@15.15.5`, `react-test-renderer@19.3.0`):**
- The real parser maps every tag to a real element:
  `svg → g → circle → circle → path → g → path → path`; root props
  `{xmlns, viewBox:"0 0 100 100", width:96, height:96}`.
- `SvgXml` mounts a real tree of **9 host elements**:
  `RNSVGSvgView → RNSVGGroup → (RNSVGCircle, RNSVGCircle, RNSVGPath) + RNSVGGroup → (RNSVGPath, RNSVGPath)`.
- Same id → byte-identical SVG; different id → different SVG.

**Method & limits (no fabricated results):** there is no iOS/Android runtime on this Windows
box, and the real `react-native` package ships Flow-typed source Node cannot parse without the
Metro/Babel/Jest pipeline. A full RN runtime is therefore **not feasible here**. To get beyond
"valid XML", `src/rn-preload.cjs` patches the CJS resolver to substitute a **host-layer test
double** (`src/shims/`) implementing the exact APIs `react-native-svg` imports
(`Platform`, `StyleSheet`, `processColor`, `findNodeHandle`, `PanResponder`, `Image`, `View`,
`PixelRatio`, `Touchable.Mixin`, `TurboModuleRegistry`, `unstable_createElement`) plus
`Libraries/Utilities/codegenNativeComponent`. The **parser, AST, tag→element mapping and
component tree are real react-native-svg code**; only the native drawing layer is stubbed. This
proves consumption/parsing, not on-device pixels. Validate real pixels in the Expo app.

## 4. Seeding

`src/seed-determinism.mjs`: 5 ids (`aulora:user:8f3a1c`, `…8f3a1d`, `…000000`,
`alice@example.com`, `bob@example.com`) → core SVG, static component, animated component and
data-URI all **5/5 distinct and repeatable**. Default normalization lowercases/trims
(`"Alice@Example.COM"` ≡ `"alice@example.com"`); `normalize:false` keeps case.

## 5. react-native-svg version + peer friction

- Installed **15.15.5**, MIT, deps `css-select@5.2.2`, `css-tree@1.1.3`.
- Peer deps are `react@*`, `react-native@*`. We installed with `--legacy-peer-deps`; without it
  npm tries to pull the full `react-native` package, and `npm ls` reports
  `UNMET DEPENDENCY react-native@*`. In the real app `react-native` is present, so this is a
  spike artifact — but note React 19's test renderer is **deprecated** and only flushes under
  `act()`.
- `@blobatar/react-native@2.7.0` peers: `blobatar 2.x`, `react >=18`, `react-native >=0.76`,
  `react-native-svg >=15`, and (for `/animated` only, optional) `react-native-reanimated >=4` +
  `react-native-worklets >=0.5`. Its own docs warn the JS/native halves of `react-native-worklets`
  must match exactly (Expo SDK) or it throws `Mismatch between JavaScript part and native part`.

## 6. Recommendation & top risks

Keep **blobatar**; it is the smallest thing that meets every goal (deterministic by id, zero
core deps, MIT, raw SVG string for mobile, React DOM for web). Build the mobile avatar path around
`blobatar` + `<SvgXml>`; add `@blobatar/react-native` only if/when mobile animation is required.

Risks, highest first:
1. **Youth / bus factor 1.** ~6 weeks old, one maintainer, 12 versions. Vendor the generator or
   pin exact versions and keep our own golden fixture of expected SVG output.
2. **Generation majors (ADR-0008).** `blobatar@3` will change every user's face and
   `@blobatar/react@2.x` hard-pins `blobatar@2.x`; upgrades are breaking by design.
3. **String API is static on mobile.** `animate` is honored only by framework adapters; the
   string→`SvgXml` route yields no motion (the idle layer is CSS). Animated mobile needs the
   heavier `@blobatar/react-native/animated` + reanimated/worklets.
4. **ESM-only, no CJS entry.** Fine under Metro/Expo, but any CJS-only tooling path needs bundling.
5. **Headless evidence gap.** Native proof is parse+tree, not on-device pixels (see §3).
6. `blobatar/react` subpath is deprecated and removed in v3 — import from `@blobatar/react`.

## Files

- `package.json` — pinned deps + `web` / `native` / `seed` / `exports` / `verify` scripts
- `src/inspect-exports.mjs`, `src/web-render.mjs`, `src/native-render.mjs`, `src/seed-determinism.mjs`
- `src/rn-preload.cjs`, `src/shims/` — headless `react-native` test double (documented above)
- `evidence/verify-output.txt` — captured `npm run verify` output (exit 0)
- `package-lock.json` — exact resolved tree
