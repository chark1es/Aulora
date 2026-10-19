# Desktop, docs, shared packages, infra findings

Read-only audit of `apps/desktop`, `apps/docs`, `packages/{ui-web,ui-native,core,avatars,tokens,bot-sdk,bot-sdk-python,config}` and `infra/{docker,push-relay,bot-runner}`.

## Summary (5 bullets max)

- **The desktop app embeds the whole web dist: 17 MB, of which 13.6 MB is on-demand MediaPipe vision WASM + RNNoise models** and ~1.4 MB of third-party notices (`apps/desktop/src-tauri/tauri.conf.json:7` + web build output). Every install and every signed update carries it, though most users never start background blur/noise suppression.
- **The web client ships one 1.19 MB (344 KB gzip) main chunk with no route-level code splitting**; the desktop cold start parses every route, and the same chunk is embedded in the app (`apps/web/vite.config.ts:48`, build output).
- **The docs site loads ~58 KB (15.7 KB gzip) of JS on all 23 pages** — the 38 KB demo/download/env-filter modules are used by 1–3 pages — and the env-reference page duplicates every description into a `data-search` attribute, making it 141 KB (`apps/docs/static/site.js:5`, `apps/docs/lib/env-reference.mjs:99`).
- **Shared packages cannot be tree-shaken:** no `sideEffects` flag anywhere, `@aulora/core` is one mega-barrel with module-level side effects, which is why route code cannot be dropped (`packages/core/package.json`, `packages/core/src/permissions.ts:56`).
- **Infra is close to good, with three concrete gaps:** the push relay signs a new APNs JWT and opens/closes a fresh HTTP/2 connection per notification with no timeout (`infra/push-relay/src/providers.mjs:192,220`); nginx runs default gzip level with no `gzip_vary`/`gzip_static`/brotli (`infra/docker/nginx/default.conf.template:160`); the bot runner polls Convex every 3 s even with zero bots (`infra/bot-runner/src/config.mjs:55`).

## Desktop

### P1. The desktop app embeds the full 17 MB web dist, including 13.6 MB of on-demand ML assets
**Evidence** `apps/desktop/src-tauri/tauri.conf.json:7` (`"frontendDist": "../../web/dist"`); build output of `bun run --cwd apps/web build`:
```
dist/assets/vision_wasm_internal-BWEwtLSW.wasm      12,997.24 kB │ gzip: 3,896.98 kB
dist/assets/vision_wasm_internal-CaWMRP85.js           335.39 kB
dist/assets/selfie_segmenter_landscape-*.tflite        250.17 kB
dist/assets/rnnoise_simd-*.wasm                        157.23 kB
dist/assets/rnnoise-*.wasm                             152.65 kB
dist/legal/THIRD_PARTY_JAVASCRIPT.txt                1,443,775 B   (dist total 17,441,717 B)
```
**Problem** Tauri embeds `frontendDist` into the binary (`tauri::generate_context!`), so the app bundle, the installer and therefore every updater payload include 13.6 MB of MediaPipe/RNNoise WASM, a 250 KB tflite model and a 1.4 MB notices text file. In the browser these are lazily fetched per feature (`src/lib/voice/effects/segmenter.ts:2-4` uses `?url`, `import()` at `:52`); embedded in the app they are paid by everyone, always.
**Impact at 100k** **High.** Every desktop download/update ≈ +13.6 MB compressed-to-~4 MB; ~100k installs × 4 MB ≈ 400 GB of extra transfer per release, plus longer update times and larger disk footprint. Users who never enable background effects get zero benefit.
**Effort** Medium (build wiring + fallback for offline use).
**Risk** Medium: background blur/noise suppression must still work; if the assets are fetched from the workspace server, offline/slow-server behaviour changes.
**Proposed fix** Exclude `assets/**` (or a dedicated `effects/` dir) from `frontendDist` and load those models from the workspace origin (already reachable — the CSP `connect-src` allows `https:`), or ship them as an optional Tauri `resource` downloaded on first use. At minimum, drop `dist/legal/` from the embedded client and ship it with the desktop bundle's `legal/` resources (already done at `tauri.conf.json:55`) instead of duplicating it.

### P2. One 1.19 MB main chunk, no route-level code splitting
**Evidence** build output: `dist/assets/index-DHn1t7Ez.js 1,188.87 kB │ gzip: 343.91 kB` and Vite's own warning ("Some chunks are larger than 500 kB").
`apps/web/vite.config.ts:48-56` sets `outDir`, `sourcemap: false`, `assetsInlineLimit` and nothing else — no `manualChunks`/`codeSplitting`. Only the `/__preview*` routes are lazy (`apps/web/src/router.tsx:24-51`); chat, admin, kanban, notes, settings, the call engine and sounds are all in the entry chunk.
**Problem** The desktop webview parses and executes the entire client before first paint, and `livekit-client` (556 KB) is one `await import()` away from a user who never starts a call but still pays for the JS parse of ~1.2 MB.
**Impact at 100k** **Medium.** Cold-start latency and memory on every launch for every desktop user; worse on low-end Windows machines. Web bundle transfers are per-session (cached), so bandwidth matters less than parse/startup.
**Effort** Medium.
**Risk** Low–medium: chunking can regress caching or cause duplicate chunks if route boundaries are wrong; needs a smoke test of lazy routes.
**Proposed fix** Convert top-level routes to `lazy()` with a shared layout, and add `build.rollupOptions.output.manualChunks` (or rolldown `codeSplitting`) splitting `livekit-client`, `@mediapipe/tasks-vision`, `convex`, and the kanban/notes features. Target an entry chunk well under 500 KB.

### P3. The updater holds the entire installer in memory and emits an IPC event per network chunk
**Evidence** `apps/desktop/src-tauri/src/updater.rs:28` (`AppUpdateState(Mutex<Option<(Update, Vec<u8>)>>)`), `:103-119` (`update.download(...)` collects all bytes, stores them in state), `:107` (`handle.emit("aulora://app-update-progress", ...)` inside the per-chunk callback), `:135` (`update.install(bytes)`).
**Problem** The downloaded artifact stays resident for the rest of the session (until install or quit), and the progress callback emits one IPC event per streamed chunk — hundreds to thousands of events for a 15–25 MB bundle — each one serialized to JSON and pushed into the webview.
**Impact at 100k** **Medium.** A 15–25 MB resident buffer is a large fraction of the shell's idle footprint on top of the webview; the event flood is wasted main-thread work at exactly the moment the user is installing. Low steady-state cost, but it is avoidable.
**Effort** Low (throttle emissions) / Medium (stream to disk).
**Risk** Low: throttling progress events is cosmetic; streaming to a temp file changes the `install` call path and needs a Windows check.
**Proposed fix** Throttle progress to ~10/s (emit only when `downloaded` crossed a coarse threshold, or on a 100 ms timer). For memory, write chunks to a temp path and pass the path to `install`, or at least drop the buffer when the update prompt is dismissed.

### P4. Tauri features are not target-scoped, so every platform compiles the others' support
**Evidence** `apps/desktop/src-tauri/Cargo.toml:18` (`features = ["macos-private-api", "tray-icon", "image-png"]`), `:11` (`crate-type = ["staticlib", "cdylib", "rlib"]`), `tauri.conf.json:13` (`"withGlobalTauri": true`), `:38` (`"targets": "all"`).
**Problem** `image-png` exists only for the Windows overlay badge (`src/window.rs:43`), and `macos-private-api` only for macOS vibrancy — both are compiled into Linux/Windows/macOS builds unconditionally. The `staticlib`/`cdylib` crate types are mobile scaffolding, unused by a desktop-only workspace, and add build time. `withGlobalTauri` injects the whole `@tauri-apps/api` global script into every page; the web client genuinely needs it (`apps/web/src/lib/desktop.ts:9,29,47` uses `window.__TAURI__` and carries no npm dependency), but it is a deliberate payload/CSP-surface tradeoff worth recording.
**Impact at 100k** **Low.** A few hundred KB of binary at most; mostly build-time and attack-surface cleanliness, not user-visible cost.
**Effort** Low (config) / Medium (per-target feature gymnastics for `image-png`).
**Risk** Low: `withGlobalTauri` removal would break the web/desktop bridge unless the web client switched to the npm package — do not change that here.
**Proposed fix** Drop `staticlib`/`cdylib` from `[lib] crate-type` for the desktop-only build; gate the badge code behind a `windows-badge` feature that enables `tauri/image-png`. Leave `withGlobalTauri` as-is and document it.

### P5. Update checks and a 5 s re-render timer run per client
**Evidence** `apps/web/src/providers/DesktopUpdateProvider.tsx:121` (`void check()` on mount), `:134-139` (`setInterval(() => check(), 6*60*60*1000)`); `apps/web/src/providers/WorkspaceUpdateProvider.tsx:45-51` (`setInterval(() => setNow(Date.now()), 5000)`), `:70-71` (`void check()` + 6 h interval, owners only).
**Problem** Both providers check on every launch and every 6 h. The app-update check hits the GitHub Releases feed; the workspace check calls a Convex action (`api.updates.check`) that itself reaches GitHub. The 5 s `setNow` tick exists only to age a 30 s host heartbeat (`hostConnected`), but it re-creates the provider's `settings` React node and context value on every tick, re-rendering all `useWorkspaceUpdates` consumers.
**Impact at 100k** **Medium (server) / Low (client).** 100k clients × ~4–5 update checks/day ≈ 0.5M feed hits/day (fine for a CDN) but the owner-triggered `updates.check` action is real backend work; the 5 s timer is 17k wasted renders/day per open desktop client.
**Effort** Low.
**Risk** Low.
**Proposed fix** Jitter the intervals (e.g. 6 h ± 30 min) so launches do not align; skip the workspace `check` when a host watcher heartbeat is fresh (`hostConnected` already gates `checkNow`, do the same for the interval); replace the 5 s `setNow` tick with a timeout scheduled at `hostSeenAt + 30 s`.

### P6. `bundle.targets: "all"` in the base config
**Evidence** `apps/desktop/src-tauri/tauri.conf.json:38` (`"targets": "all"`), overridden per platform by `tauri.macos.conf.json` (`["app","dmg"]`), `tauri.windows.conf.json` (`["nsis"]`), `tauri.linux.conf.json` (`["deb"]`).
**Problem** Any build path that does not pass the platform config (`bun run tauri:build`, a bare `tauri build`, a CI step that forgets `--config`) produces every bundle format Tauri supports — `app`, `dmg`, `deb`, `rpm`, `AppImage`, `msi`, `nsis` — multiplying build time and release artifacts. The wrapper script (`scripts/build.mjs:139-147`) only adds the release config when signing, and `--target all` skips Linux entirely.
**Impact at 100k** **Low–Medium.** CI minutes and confusing/oversized release assets, not runtime cost.
**Effort** Low.
**Risk** Low.
**Proposed fix** Set the base `targets` to a single sensible default (or `[]`) and require the platform configs to opt in; reorder `--target all` to include Linux behind the same guard.

## Docs

### P7. Every page eagerly downloads ~58 KB of JS, most of it for features on other pages
**Evidence** `apps/docs/static/site.js:5-8` statically imports `demo.js`, `downloads.js`, `env-filter.js`, `search.js`; `:10-11` mounts search and the env filter unconditionally; `apps/docs/scripts/build.mjs:107` puts `<script type="module" src="site.js">` in the shared `<head>`, and `:365` copies all of `static/` for every page.
Measured raw/gzip:
```
site.js 2,484/1,092  search.js 9,472/3,061  downloads.js 8,622/3,050
env-filter.js 1,681/751  demo.js 10,944/3,050  demo-data.js 9,073/3,020
demo-view.js 15,918/3,799  →  total 58,194 / 15,710
```
The demo exists only in `landing/index.html` (`data-demo`), downloads only in `landing/index.html` + `landing/install.html`, and the env filter only in the generated env page — yet all 23 HTML pages fetch all of it.
**Problem** Docs readers pay ~58 KB (15.7 KB gzip, 7 requests) before progressive enhancement runs, and the modules are evaluated on pages that never use them.
**Impact at 100k** **Medium.** ~100k monthly docs visits × 15.7 KB ≈ 1.6 GB/month of avoidable transfer, plus 7 round-trips and parse work per docs page; the site is billed as a reading experience.
**Effort** Low.
**Risk** Low: progressive enhancement only, guarded by the same selectors already used.
**Proposed fix** Keep `site.js` as a small entry that dynamically imports per feature: `if (document.querySelector('[data-demo]')) import('./demo.js').then(m => m.mountDemo(...))`, same for downloads, env-filter and copy buttons. Or split `site.js` per page group at build time (`build.mjs` already knows the page kind).

### P8. The env-reference page duplicates every key and description into a `data-search` attribute
**Evidence** `apps/docs/lib/env-reference.mjs:99` (`<div class="env-var" data-env-var data-search="${escapeHtml(searchText(variable))}">`); 148 rows in `dist/docs/environment-variables.html`; that page is 141,481 B — the largest in the site — versus 44,697 B for the landing page and ~11 KB for a typical docs page.
**Problem** Each row carries its key, label, group and full description twice: once as visible markup, once as a lowercased/merged string in `data-search`. The filter (`static/env-filter.js:5-7,22`) only needs a case-insensitive substring match, and the row's own `textContent` already contains all of it.
**Impact at 100k** **Medium.** ~141 KB (14.4 KB gzip) per visit to the single most-linked self-hosting page; roughly half of it is redundant attribute text that must also be parsed and stored in the DOM.
**Effort** Low.
**Risk** Low: the filter must still match on key + description; `textContent` includes the "Copy"/badge chrome, so assert the filter tests still pass.
**Proposed fix** Drop `data-search` and build the haystack lazily in `mountEnvFilter` from `variable.textContent.toLowerCase()` (cached per row after first use). This halves the page and removes a build-time escaping path.

### P9. No minification or precompression, and no compression/caching guidance for the docs host
**Evidence** `apps/docs/scripts/build.mjs` writes generated HTML raw (`:384-388`) and `JSON.stringify(buildSearchIndex(...))` raw (`:391-395`), and copies `static/` byte-for-byte (`:365`); measured `dist/` = 792 KB, `landing.css` 39,706 B (7,500 B gzip), `site.css` 10,005 B, `search-index.json` 85,232 B (26,161 B gzip). The only compression configuration in the repo is for the **web SPA image** (`infra/docker/nginx/default.conf.template:160-161`) and the Caddy example (`infra/docker/proxy/Caddyfile.example:11`); the docs ship as a zip release artifact (`.github/workflows/release.yml:90-112`) with no server config of their own.
**Problem** Nothing minifies the hand-written CSS/JS or the generated HTML, and nothing guarantees the docs are served compressed or with cache headers. If an operator unzips the artifact onto a host without `gzip_static`/brotli, every page ships uncompressed (141 KB env page, 45 KB landing page, 40 KB CSS).
**Impact at 100k** **Medium.** ~2–3× transfer on every docs request in the uncompressed case; `landing.css` and the shared CSS are re-validated per navigation because no cache policy is stated.
**Effort** Low–Medium.
**Risk** Low: precompressed variants are additive; adding `gzip_static`/`try_files` to the docs host is deployment-only.
**Proposed fix** Emit `.gz` (and `.br` where available) next to every emitted file in `scripts/build.mjs`, and document a 4-line nginx/Caddy snippet for the docs host (`gzip_static on;` / `encode zstd gzip`) plus `Cache-Control: public, max-age=31536000, immutable` for hashed-named or content-stable assets and `max-age=300` for HTML. Minify `landing.css`/`site.css`/`docs.css`/JS with a tiny build step (or accept raw CSS and rely on compression — the numbers above show gzip recovers most of it).

### P10. The search index ships full section text and is fetched on first focus
**Evidence** `apps/docs/lib/search-index.mjs:7` (`MAX_SECTION_CHARS = 600`), `:33-51` (every heading becomes an entry with up to 600 chars of body text); `apps/docs/scripts/build.mjs:391-395` writes it; `static/search.js:144` fetches it lazily. Measured: 145 entries, 68,545 chars of text, 85,232 B raw / 26,161 B gzip.
**Problem** The index is a full-text dump, not an inverted index or a title/snippet index; the browser downloads and then linearly scores all 145 entries (tokenizing title, heading and body per entry per keystroke).
**Impact at 100k** **Low–Medium.** Only users who open search pay 26 KB gzip, but scoring is O(entries × tokens) on every input event, on the main thread, and the payload grows linearly with docs.
**Effort** Medium.
**Risk** Low–medium: changing the index shape touches `search.js` scoring, `lib/search-index.mjs` and their tests.
**Proposed fix** Lower `MAX_SECTION_CHARS` (150–200 is plenty for a result preview) and store the preview separately from the match text; optionally precompute a token→entry posting list at build time so the client scores a candidate set instead of every entry.

### P11. Landing/install pages call the unauthenticated GitHub API from the browser
**Evidence** `apps/docs/static/downloads.js:132-166` (`loadRelease`), `:146` (`fetch("https://api.github.com/repos/chark1es/Aulora/releases/latest")`), cached in `sessionStorage` for 1 h (`:136-142`).
**Problem** The release lookup happens client-side against GitHub's unauthenticated API (60 requests/hour/IP). Behind a shared NAT, corporate proxy or a busy landing page this rate-limits and the buttons silently fall back to authored links; it also adds a third-party RTT to the primary download CTA.
**Impact at 100k** **Medium.** Rate-limit failures degrade the main call-to-action for cohorts behind shared IPs; the failure is silent.
**Effort** Low.
**Risk** Low: a build-time manifest needs a release-time refresh, which the release workflow already has (`apps/desktop/scripts/release-manifest.mjs` produces `latest.json`).
**Proposed fix** Publish the release asset list as a static `releases.json` on the docs origin (generated in `release.yml` alongside the existing `latest.json`) and have `loadRelease` fetch that first, with the GitHub API only as a fallback. Keep the sessionStorage cache.

## Shared packages

### P12. No `sideEffects` flag anywhere, and module-level work in the core barrel
**Evidence** `grep -rn sideEffects packages/*/package.json apps/*/package.json` returns nothing. `packages/core/src/permissions.ts:56` (`const PERMISSION_BY_NAME = new Map<string, bigint>(Object.entries(Permission));`), `:53` (`Object.keys(Permission)`), `:58` (`Object.values(...).reduce(...)`) all run at module scope. `packages/core/src/index.ts` uses `export *` for `bots`, `chat/index`, `kanban`, `notes/index` and `voice/index` (`:19,20,43,51,170`).
**Problem** Without `"sideEffects": false`, a bundler must assume every re-exported module has side effects, so it cannot drop the parts of `@aulora/core` a route does not use — which is a direct contributor to the single 1.19 MB chunk in P2. The `Object.entries(Permission)` map is genuine top-level work that runs whenever the module is retained.
**Impact at 100k** **Medium.** Larger entry chunk and more parse/eval on every desktop launch and web load; the effect compounds as core grows.
**Effort** Low.
**Risk** Low–medium: `sideEffects: false` on a package that does have module-scope effects (e.g. CSS imports in `packages/avatars`, see below) will silently drop them — audit each package before flipping it.
**Proposed fix** Add `"sideEffects": false` to `packages/core`, `packages/tokens`, `packages/ui-web` (all pure) and verify with a production build that no CSS/registration is dropped. `packages/avatars` must keep `"./live"` (it imports `blobatar/gaze.css` and `blobatar/motion.css` at `src/live.tsx:4-5`) out of the `false` claim, e.g. `"sideEffects": ["./src/live.tsx", "**/*.css"]`. Move the `PERMISSION_NAMES`/`PERMISSION_BY_NAME` derivation behind a lazy accessor so a module import stays effect-free.

### P13. `@aulora/core` is a single barrel that every client imports wholesale
**Evidence** `packages/core/src/index.ts` re-exports attachments, binary, blurhash, bots, chat, errors, invites, kanban, members-grouping, notes, outbox, permissions, profiles, search, server-url, sign-in, sounds, unread, updates, voice and well-known. `apps/web/src` has 165 `from "@aulora/core"` import sites (60 of them `import type`), `apps/mobile/src` has 83.
**Problem** Because there is no subpath export (`exports: { ".": "./src/index.ts" }` only), a component that needs `countUnread` pulls the same specifier as one that needs the voice state machine, the notes editor and the kanban model. Tree-shaking can recover some of it, but only where P12's side-effect analysis allows.
**Impact at 100k** **Medium.** Directly bounds how much of P2's chunk can ever be split; also makes dependency intent invisible in review.
**Effort** Medium.
**Risk** Medium: broad specifier rewrite across two apps; mechanical but high-touch.
**Proposed fix** Add subpath exports (`"./chat"`, `"./notes"`, `"./voice"`, `"./updates"`, …) and migrate the heaviest consumers first (`chat`, `voice`, `notes`, `kanban`), leaving the root barrel as a deprecated convenience.

### P14. Two hand-rolled Markdown implementations of near-identical size
**Evidence** `packages/core/src/notes/markdown.ts` (5,533 B) and `apps/docs/lib/markdown.mjs` (5,512 B); both render the same subset (headings, paragraphs, fenced code, lists, blockquotes, tables, inline code/bold/italic/links) with raw-HTML escaping, and each carries its own tests (`packages/core/test/notes-editor.test.ts`, `apps/docs/lib/markdown.test.mjs`).
**Problem** The same rendering rules are maintained twice. Fixes to escaping, link rewriting or table parsing have to be made in two places, and the two can disagree for the same document.
**Impact at 100k** **Low.** No direct runtime cost — this is a maintenance/correctness risk, not a size one (5.5 KB each, and each is used in a different runtime).
**Effort** Medium (extraction + tests) or Low (do nothing).
**Risk** Medium: `core`'s renderer is consumed by the notes editor and `docs`' by the build; a shared module must stay dependency-free for the zero-dependency docs build.
**Proposed fix** Extract the shared subset into a dependency-free module (e.g. `packages/markdown`) with the existing tests moved across, or explicitly document why the two must diverge and add a test that asserts identical output on a shared fixture set.

### P15. `packages/ui-native` declares `tailwindcss` with no usage in the package
**Evidence** `packages/ui-native/package.json:33` (`"tailwindcss": "3.4.19"` in `devDependencies`); `grep -rn "tailwind" packages/ui-native --include='*.ts' --include='*.tsx'` matches only that line. The NativeWind preset it mirrors lives in `@aulora/tokens` (`createNativewindPreset`), and the app that consumes it (`apps/mobile`) brings its own Tailwind.
**Problem** An unused (and heavy) dev dependency in a design-system package: extra install time and lockfile/audit surface with no compile value.
**Impact at 100k** **Low.** Developer/CI install time only; no shipped bytes.
**Effort** Low.
**Risk** Low: confirm `nativewind`'s peer requirement is satisfied by the consumer before removing.
**Proposed fix** Drop `tailwindcss` from `packages/ui-native`; if a test or typecheck genuinely needs it, move it to a `peerDependenciesMeta`/root devDependency instead.

### P16. `@aulora/avatars` root export drags the plain-`blobatar` renderer into consumers that only want the React component
**Evidence** `packages/avatars/src/index.ts` re-exports `./svg` (`avatarDataUri`, `avatarSvg`, `normalizeAvatarSeed`), which imports `blobatar` and `blobatar/uri` (`src/svg.ts:1-2`); the React component at `src/Avatar.tsx:1` only needs `@blobatar/react`. `apps/web` imports `Avatar` from the root in several components (e.g. `components/chat/ChannelSidebar.tsx:2`, `SignedInShell.tsx:1`, `WorkspaceMenu.tsx:1`, `admin/WorkspaceBranding.tsx:1`).
**Problem** Consumers that only render `<Avatar>` share a barrel with the string/SVG helpers, so the `blobatar` core + `blobatar/uri` modules are candidates for inclusion unless tree-shaking removes them — again gated by P12.
**Impact at 100k** **Low.** `@blobatar/react` already depends on `blobatar` core, so the marginal extra is `blobatar/uri`; the real cost is bundle-shape opacity.
**Effort** Low.
**Risk** Low.
**Proposed fix** Split exports (`"./avatar"`, `"./svg"`) or mark `sideEffects` per package so the unused `blobatar/uri` branch is provably droppable.

## Infra

### P17. Push relay re-signs an APNs JWT and opens a fresh HTTP/2 connection per notification, with no timeout
**Evidence** `infra/push-relay/src/providers.mjs:192` (`const jwt = buildApnsJwt({ keyId, teamId, key, nowSeconds: now() });` inside `deliver`), `:114-123` (ES256 signing each call), `:216-234` (`defaultApnsRequest` → `http2.connect(target.origin)` per request, `request.on("close", () => { client.close(); ... })`), no `AbortSignal`/`setTimeout`/timeout anywhere in `providers.mjs`; the FCM path calls `fetchImpl(...)` with no signal either.
**Problem** Apple accepts a provider JWT for up to an hour and expects HTTP/2 connections to be reused; the relay signs a new token and performs a full TCP+TLS+HTTP/2 handshake for every single wake, then tears the connection down. A hung APNs/Google connection has no timeout, so the request handler's promise can remain pending until Node's server-level timers fire.
**Impact at 100k** **Medium.** Notification volume scales with messages, not users, so this is a per-message CPU + handshake tax on a small relay, and a stuck provider can leave requests pending until Node's server-level timeouts fire, tying up sockets and file descriptors.
**Effort** Low.
**Risk** Medium: JWT caching must respect Apple's rotation rules and key rollover; connection reuse must handle `GOAWAY`/connection errors and reconnect.
**Proposed fix** Cache the APNs JWT per (keyId, teamId) with a ~45 min TTL; hold one long-lived `http2` session per origin (lazily reconnecting) instead of connecting per push; add `AbortSignal.timeout(10_000)` to the FCM fetches and an HTTP/2 request timeout with `client.close()` on expiry. Add a bounded in-flight concurrency cap so a slow provider cannot exhaust sockets.

### P18. nginx uses default gzip settings, no precompressed variants and no cache immutability
**Evidence** `infra/docker/nginx/default.conf.template:160-161` (`gzip on;` with only `gzip_types` — no `gzip_comp_level`, `gzip_vary`, `gzip_static`, `gzip_min_length`, and no brotli), `:77-80` (`location ^~ /assets/ { expires 1y; }` — no `immutable`), `:84-95` (unhashed files revalidate, which is correct). The web image is `nginx:1.27-alpine` (`infra/docker/web.Dockerfile:38`).
**Problem** `gzip_comp_level` defaults to 1, leaving compression ratio on the table for the ~1.2 MB JS chunk; without `gzip_vary` a shared cache may serve the compressed body to a client that did not ask for it; there are no `.br`/`.gz` variants to serve with `gzip_static`, and the 1-year asset cache is not marked `immutable`, so browsers can revalidate hashed assets.
**Impact at 100k** **Medium.** At the measured gzip ratios (JS 3.9×, CSS 5.3×) level 1 vs level 6–9 is a meaningful fraction of every cold-load transfer, and `no-cache` revalidation on hashed assets wastes round-trips on repeat visits.
**Effort** Low.
**Risk** Low: `gzip_vary on` is required once caching is involved; `gzip_static` needs the precompressed files to actually exist (see P9).
**Proposed fix** Set `gzip_comp_level 6; gzip_vary on; gzip_min_length 1024;` and add `brotli on; brotli_types ...;` if the image gains the module (or rely on Caddy's `encode zstd gzip`, already present at `proxy/Caddyfile.example:11`). Add `immutable` to the `/assets/` `expires 1y` and precompress `dist/` in `web.Dockerfile` so `gzip_static`/`brotli_static` can serve files without compressing per request.

### P19. The bot runner polls Convex every 3 s even when it supervises zero bots
**Evidence** `infra/bot-runner/src/config.mjs:55` (`pollIntervalMs: positiveInt(env.BOT_RUNNER_POLL_INTERVAL_MS, 3000)`), `infra/bot-runner/src/reconciler.mjs:1-9` (the tick fetches the desired list each time), `infra/bot-runner/src/main.mjs:32-35` (starts immediately).
**Problem** The reconciler polls the desired-state API every 3 s unconditionally — 28,800 requests per deployment per day — with no long-poll, no adaptive interval when the bot set is empty, and no jitter. On the `bots` profile this is a constant baseline load against `convex-backend:3211` from an idle container.
**Impact at 100k** **Low–Medium.** Each deployment is small, but on a multi-tenant/self-hosted fleet the idle baseline is pure overhead and is the kind of request that shows up in action/HTTP-function billing and logs.
**Effort** Low.
**Risk** Low: a longer interval delays bot start/stop/restart by up to the interval; adaptive backoff must not starve restarts.
**Proposed fix** Back the interval off when nothing is running and no change is expected (e.g. 3 s with bots, 30–60 s when `bots.size === 0`), add ±20 % jitter, and rely on an explicit wake (a webhook from the bot API or a Convex scheduler trigger) where available. The interval the runner already logs at `main.mjs:33` makes the current cost easy to observe.

### P20. Backup retention is local-only and undefined remotely
**Evidence** `infra/docker/docker-compose.yml:410` (`BACKUP_RETENTION: ${BACKUP_RETENTION:-7}`), `infra/docker/backup/backup-plan.mjs:48-61` (`prunableDirectories` prunes the local `backup-data` volume), `infra/docker/backup/README.md:15-17` ("Local retention does not configure remote retention"; backups default to the live MinIO bucket).
**Problem** Object-storage backups accumulate in the same MinIO instance the app uses for user files, unbounded, with no lifecycle rule applied by the stack. The prune only touches the local staging volume.
**Impact at 100k** **Medium.** An operator who never sets an S3 lifecycle policy silently grows the object store on the same disk as uploads and search indexes; a full MinIO volume takes the workspace down. The failure is quiet and slow.
**Effort** Low (docs + default) / Medium (apply lifecycle on init).
**Risk** Low: pruning remote backups incorrectly destroys recovery points; a documented MinIO lifecycle with a conservative default is safer than code.
**Proposed fix** Document a MinIO/S3 lifecycle rule for the backup prefix (e.g. expire after 30 days) in `infra/docker/backup/README.md` and `apps/docs/content/backups.md`, and have `minio-init` apply it with `mc ilm` for the default bucket. Emit a warning at boot when `BACKUP_BUCKET` equals the storage bucket and no expiry is configured.

### P21. Docker build context carries artifacts that are never copied into any image
**Evidence** `.dockerignore` excludes `node_modules`, `dist`, `build`, `.git` and secrets, but not `store-assets/` (4.6 MB), the three committed wheels at the repo root (`pygments-2.21.0-py2.py3-none-any.whl` 1,250,147 B, `lizard-1.18.0-py2.py3-none-any.whl` 88,059 B, `pathspec-1.1.1-py2.py3-none-any.whl` 57,328 B) or `spikes/`; every image build (`web.Dockerfile`, `setup.Dockerfile`, `bot-runner.Dockerfile`, `backup/backup.Dockerfile`) uses the repo root as context.
**Problem** ~6 MB of irrelevant context is transferred and hashed on every image build, and the wheels in the repository root are a supply-chain smell (unpinned, unused by any Dockerfile).
**Impact at 100k** **Low.** Build minutes and remote-builder transfer only; no runtime effect. Coolify/CI remote builds pay it on every deploy.
**Effort** Low.
**Risk** Low.
**Proposed fix** Add `store-assets/`, `spikes/`, `*.whl` and `docs/` to `.dockerignore` (keeping `licenses/`, which `web.Dockerfile:31` copies), and remove the committed wheels if nothing references them.

## Sizes measured (raw commands + output)

```sh
$ du -sh apps/* packages/* infra/* | sort -h
 20K  packages/config        68K  packages/avatars       116K  infra/bot-runner
 84K  packages/tokens        124K packages/bot-sdk-python 124K packages/ui-native
128K  packages/bot-sdk       168K packages/ui-web         372K apps/desktop
380K  infra/docker           392K apps/docs               560K packages/core
```

```sh
# Web build (the assets Tauri embeds via frontendDist)
$ bun run --cwd apps/web build
✓ 794 modules transformed.
dist/index.html                                    0.71 kB │ gzip:   0.42 kB
dist/assets/index-MUbIxZSr.css                    80.99 kB │ gzip:  14.50 kB
dist/assets/vision_bundle-0lqtqi3e.js            154.29 kB │ gzip:  45.57 kB
dist/assets/livekit-client.esm-BDqg5Avu.js       555.83 kB │ gzip: 144.73 kB
dist/assets/index-DHn1t7Ez.js                  1,188.87 kB │ gzip: 343.91 kB   (chunk >500 kB warning)
dist/assets/vision_wasm_internal-CaWMRP85.js      335.39 kB
dist/assets/vision_wasm_internal-BWEwtLSW.wasm 12,997.24 kB │ gzip: 3,896.98 kB
dist/assets/selfie_segmenter_landscape-*.tflite    250.17 kB
dist/assets/rnnoise_simd-*.wasm                    157.23 kB
dist/assets/rnnoise-*.wasm                         152.65 kB
dist/assets/workletProcessor-*.js                   64.48 kB
$ du -sh apps/web/dist  → 17M      # 17,441,717 B total
$ find apps/web/dist -type f | wc -l → 41 files
```

```sh
# Docs build
$ node apps/docs/scripts/build.mjs
docs: wrote 4 marketing pages and 16 docs pages
$ du -sh apps/docs/dist  → 792K, 41 files
$ find apps/docs/dist -type f -exec wc -c {} + | sort -rn | head
85467 dist/search-index.json
44697 dist/index.html
39706 dist/landing.css
29734 dist/how-it-works.html
21875 dist/docs/self-hosting.html
15918 dist/demo-view.js
10944 dist/demo.js
10005 dist/site.css
  ... dist/docs/environment-variables.html = 141481
$ wc -c apps/docs/static/*.js apps/docs/static/*.css
 2484 site.js   9472 search.js   8622 downloads.js   1681 env-filter.js
10944 demo.js    9073 demo-data.js  15918 demo-view.js
10005 site.css   9946 docs.css    39706 landing.css
# gzip of the JS the shared <head> pulls on every page:
$ cat site.js search.js downloads.js env-filter.js demo.js demo-data.js demo-view.js | wc -c
58194      # 15,710 gzip
$ node -e "const j=require('./apps/docs/dist/search-index.json'); console.log(j.entries.length)"
145        # 85,232 B raw / 26,161 B gzip, 68,545 chars of text
$ gzip -c apps/docs/dist/docs/environment-variables.html | wc -c   → 14432
```

```sh
$ find apps/desktop -type f -not -path '*/target/*' -exec du -k {} + | sort -rn | head
136 src-tauri/Cargo.lock      80 src-tauri/app-icon.png      12 scripts/verify-config.mjs
$ grep -c '^\[\[package\]\]' apps/desktop/src-tauri/Cargo.lock   → 535 crates
# src-tauri/icons/ is generated + gitignored; no Rust toolchain/target in this
# workspace, so the compiled .app/.exe size was not measured here.
```

```sh
$ du -sh node_modules (repo root) → 927M ; repo root total → 982M
$ ls -la *.whl   → pygments 1,250,147 B; lizard 88,059 B; pathspec 57,328 B
```

## Already-good notes

- **Desktop release profile** is Tauri's recommended one and already right for size: `lto = true`, `codegen-units = 1`, `opt-level = "s"`, `panic = "abort"`, `strip = true` (`apps/desktop/src-tauri/Cargo.toml:29-34`). No sidecar is used, and the webview loads only bundled assets — there is no remote-code path (`tauri.conf.json:7`, `lib.rs:7-8`).
- **Desktop CSP and capability scope are tight:** `script-src 'self' 'wasm-unsafe-eval'` with `object-src 'none'`, and only `core:default` + `core:window:allow-start-dragging` are granted (`tauri.conf.json:26`, `capabilities/default.json`). `scripts/verify-config.mjs` fails the build if the CSP regresses — a real guardrail worth keeping.
- **No background update polling storm:** the shell never polls on its own; checks happen only on explicit menu action (`updater.rs:61-73`) or the web client's 6 h interval, and the updater verifies minisign signatures before storing bytes (`updater.rs:101-102`).
- **Updater feed is validated at build time:** `scripts/release-manifest.mjs` rejects missing signatures, non-https URLs and malformed targets, so `latest.json` can never publish an unsigned artifact.
- **Web assets are pre-minified and hash-named** by Vite (`sourcemap: false`, hashed filenames), which is what makes the nginx 1-year `/assets/` cache safe (`web.Dockerfile`, `default.conf.template:77-80`), and unhashed shell files correctly revalidate (`:84-95`).
- **Docs is genuinely zero-dependency** at build time (only local `lib/*.mjs` plus `blobatar` from the avatars package) and CI runs a generated-site link/anchor checker (`bun run docs:check` → `scripts/check-docs.mjs`), so broken links do not ship.
- **Docs progressive enhancement is real:** every feature is guarded by a selector and a no-JS reader still gets full content (`static/site.js:52-72`), the copy button falls back to "Press ⌘C" (`:20`), and search/downloads degrade to authored links.
- **Push relay is stateless and does not poll.** It is a single `POST /v1/wake` endpoint with an 8 KB body cap, timing-safe bearer comparison, extra-field rejection and content-free payloads (`push-relay/src/server.mjs:28-109`, `providers.mjs:58-100`). It runs as non-root on `node:22-alpine` with no writable filesystem needed (`push-relay/Dockerfile:14`).
- **Bot-runner isolation is thorough:** per-bot uid/gid with `prlimit`, read-only root filesystem, `cap_drop: ALL` (only SETUID/SETGID/CHOWN/KILL added), `no-new-privileges`, `pids_limit`, `mem_limit: 4g`, `cpus: 4`, dedicated `bots` network that excludes postgres/MinIO/web, and a separate `/work` tmpfs (`docker-compose.yml:308-366`). Logs are batched, clipped and size-capped (`bot-runner/src/logs.mjs:21-80`).
- **All Compose services cap JSON logs at 10 MB × 3 files** via the shared `x-logging` anchor (`docker-compose.yml:20-24`), so a noisy backend cannot fill the disk — this is the single most effective logging control and it is already in place.
- **Images are pinned** by digest (Convex backend/dashboard, `mc`) or explicit tag (postgres 17, nginx 1.27-alpine, bun 1.4.0, MinIO AGPL release, Vault 1.18, LiveKit 1.13.8), documented in `infra/docker/README.md:86-101`. `.dockerignore` keeps secrets, `.env`, key material and provisioning profiles out of every build context.
- **Backups record status, size and location per run** and prune locally, with a documented restore path (`backup-plan.mjs:67-90`, `apps/docs/content/backups.md`). The encryption manifest deliberately contains no key.
- **Shared packages carry no third-party runtime libraries** to duplicate: no date lib, no markdown package, no lodash/clsx (`grep` found only local modules). `packages/bot-sdk` has zero runtime dependencies and `packages/bot-sdk-python` is standard-library only (`pyproject.toml` `dependencies = []`).
- **`@aulora/tokens` icons are a single shared source** for web and native: 23 Material Symbols paths, 39 KB, generated by `scripts/generate-icons.mjs` and rendered identically by `ui-web/src/Icon.tsx` and `ui-native/src/Icon.tsx`. `@aulora/avatars` correctly depends on one upstream (`blobatar` + its `@blobatar/react` binding) rather than two competing libraries.
- **Heavy web libraries are already lazy:** `livekit-client` and `@mediapipe/tasks-vision` are `await import()`ed only when a call/screen-share/effect starts (`apps/web/src/lib/voice/sfu-room.ts:167`, `effects/segmenter.ts:52`), and `vite.config.ts:11-13` keeps their WASM/JS as separate files so the CSP can execute them.

