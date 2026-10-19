# Docs, infra, shared-package and desktop optimization implementation

Branch: `t3/scale-resource-optimization`. One focused commit per item, only the
changed paths staged. No schema, API-contract, data or UX-behaviour changes.
`packages/convex`, `apps/web/src` and `apps/mobile/src` were not touched; no new
runtime npm dependency was added (Node's built-in `zlib` only).

Verification run after every commit (from the repo root):

```
# docs
bun run --cwd apps/docs typecheck && bun run --cwd apps/docs lint \
  && bun run --cwd apps/docs test && bun run docs:check
# shared packages
bun run --cwd packages/<pkg> typecheck && bun run --cwd packages/<pkg> lint
bun run --cwd apps/web build && bun run --cwd apps/mobile typecheck
# infra
bun run test:infra
# desktop
bun run --cwd apps/desktop lint \
  && bun test apps/desktop/scripts/release-version.test.mjs apps/desktop/scripts/release-manifest.test.mjs \
  && bun run --cwd apps/desktop verify
```

Final state: all commands pass. `test:infra` = 71 node tests + 6 bun tests;
desktop release tests = 4 pass.

| # | Item | Status | Commit |
| --- | --- | --- | --- |
| 1 | P7 — docs eager JS | landed | `7b5b14e` |
| 2 | P8 — env-reference `data-search` | landed | `63e11b7` |
| 3 | P9 — docs precompression | landed | `bae2ed5` |
| 4 | P18 + W17 — nginx gzip/caching | landed | `552b60b` |
| 5 | P12 + P16 — `sideEffects` + avatars subpaths | landed | `933e7dc` |
| 6 | P19 — bot-runner adaptive polling | landed | `dbcfa7e` |
| 7 | P15 — drop unused `tailwindcss` | landed | `aa49187` |
| 8 | P21 — `.dockerignore` | landed | `be45bd4` |
| 9 | P3 — updater progress throttle | landed | `d2df500` |
| 10 | P4 + P6 — desktop crate types / bundle targets | landed | `148da14` |
| 11 | P20 — remote backup retention docs | landed | `c6e5a25` |

---

## 1. P7 — load feature scripts on demand — `7b5b14e`

- **Files**: `apps/docs/static/site.js`.
- **What**: `site.js` keeps the copy-button, mobile-nav and table-of-contents
  enhancements and now `void import(...)`s `demo.js`, `downloads.js`,
  `env-filter.js` and `search.js` only behind the selectors those features
  already used (`[data-demo]`, `[data-downloads], [data-download]`,
  `[data-env-filter]`, `[data-search]`). The no-JS fallback and every
  progressive-enhancement guard are untouched; `build.mjs:365` still copies all
  of `static/` for every page.
- **Why (perf impact)**: all 23 pages pulled the 38 KB demo/download/env-filter
  modules they never used.
- **Measurement**: eager set before 58,194 B raw / 15,710 B gzip / 7 requests.
  After, a typical docs page loads `site.js` (3,176 B / 1,307 B gzip) plus the
  shared-header search (9,472 B / 3,058 B gzip) ≈ 12.6 KB raw / 4.4 KB gzip; the
  demo and downloads load only on the landing/install pages.
- **Verify**: `typecheck`, `lint`, `test` (23 tests) and `docs:check` pass.

## 2. P8 — build the env-filter haystack from the row — `63e11b7`

- **Files**: `apps/docs/lib/env-reference.mjs`, `apps/docs/static/env-filter.js`,
  `apps/docs/lib/env-reference.test.mjs`.
- **What**: removed the per-row `data-search="…"` attribute (and the
  `searchText()` helper that produced it). `env-filter.js` builds a lowercased
  haystack from `variable.textContent` plus the row's group id, cached in a
  `WeakMap` per row. Matching on key, description, metadata and group is kept.
  A new test asserts rows still carry `data-env-var` and the page no longer
  duplicates every field.
- **Why**: the generated page was the largest in the site because every row
  repeated its key, label, group and description in a lowercased attribute.
- **Measurement**: `docs/environment-variables.html` 141,481 B → 123,297 B
  (−18,184 B, −12.9%); gzip ~14,432 B → 11,540 B.
- **Verify**: `typecheck`, `lint`, `test` (24 tests) and `docs:check` pass; 148
  rows, 0 `data-search` attributes in the output.

## 3. P9 — precompress text assets at build time — `bae2ed5`

- **Files**: `apps/docs/scripts/build.mjs`.
- **What**: after the site is written, a sorted `precompress()` walk emits a
  `.gz` sibling (`zlib.gzipSync`, level 9) for every `html/js/css/json/svg` asset
  ≥ 1 KB when one does not already exist. Existing `.gz` files are left as-is,
  and `.gz` files keep the `.html`/text extensions out of the link checker.
- **Why**: nothing guaranteed the docs ship compressed; a host without
  `gzip_static` transferred the 123 KB env page and 40 KB CSS raw.
- **Measurement**: 35 `.gz` files emitted. Env page 123,297 → 11,513 B, index
  44,697 → 9,492 B, `landing.css` 39,706 → 7,378 B, `site.css` 10,005 → 2,870 B,
  `search-index.json` 85,467 → 26,066 B. Two consecutive builds produce identical
  `.gz` checksums (deterministic).
- **Verify**: `typecheck`, `test` and `docs:check` pass.

## 4. P18 + W17 — nginx gzip, precompressed variants and immutable assets — `552b60b`

- **Files**: `infra/docker/nginx/default.conf.template`.
- **What**: `gzip_comp_level 6`, `gzip_min_length 1024`, `gzip_vary on`,
  `gzip_static on`; brotli directives are left commented with a note that the
  official `nginx:1.27-alpine` image has no `ngx_brotli`. The hashed `/assets/`
  block gains `Cache-Control: public, max-age=31536000, immutable` on top of
  `expires 1y`.
- **Why**: default level (1) wasted ratio on the multi-MB JS chunk, no
  `gzip_vary` risked a cache serving compressed bodies to the wrong client, and
  hashed assets were revalidated.
- **Measurement**: reasoned; `gzip_static` needs the P9 `.gz` siblings to exist
  (docs host) — the web image falls back to on-the-fly compression.
- **Verify**: `bun run test:infra` passes. Placeholder
  `${NGINX_CLIENT_MAX_BODY_SIZE}` is unchanged. The image was not rebuilt here.

## 5. P12 + P16 — `sideEffects` and avatars subpaths — `933e7dc`

- **Files**: `packages/core/package.json`, `packages/tokens/package.json`,
  `packages/ui-web/package.json`, `packages/ui-native/package.json`,
  `packages/avatars/package.json`.
- **What**: `"sideEffects": false` on the four pure packages;
  `"sideEffects": ["./src/live.tsx", "**/*.css"]` on `@aulora/avatars` (its
  live entry imports the blobatar CSS). `@aulora/avatars` also gains `./avatar`
  and `./svg` subpaths while the root export keeps working.
- **Why**: without the flag bundlers must assume every re-export has effects
  and cannot drop unused parts of the barrels; the avatars root barrel dragged
  the `blobatar`/`blobatar/uri` SVG helpers into `Avatar`-only consumers.
- **Measurement**: reasoned; the subpaths are additive and no consumer was
  migrated (apps/web/src and apps/mobile/src are off-limits).
- **Verify**: typecheck + lint pass for all five packages; `bun run --cwd
  apps/web build` succeeds; `bun run --cwd apps/mobile typecheck` passes.

## 6. P19 — adaptive bot-runner polling — `dbcfa7e`

- **Files**: `infra/bot-runner/src/config.mjs`, `src/runner.mjs`, `src/main.mjs`,
  `src/reconciler.mjs`, `test/helpers.mjs`, `test/config.test.mjs`,
  `test/runner.test.mjs`.
- **What**: new `pollDelayMs()` picks the active cadence
  (`BOT_RUNNER_POLL_INTERVAL_MS`, 3 s) while a bot is tracked and the idle
  cadence (`BOT_RUNNER_POLL_IDLE_MS`, default 45 s) when none is, with a ±20 %
  jitter (`BOT_RUNNER_POLL_JITTER`, default 0.2). A bot waiting on a crash
  backoff still counts as tracked, so relaunch latency stays bounded.
- **Why**: the reconciler fetched the desired set every 3 s unconditionally —
  28,800 requests/day per deployment with zero bots.
- **Measurement**: reasoned; the pure helper is unit tested and an integration
  test asserts fast polling with a bot then ≤ 1 poll per 300 ms once it stops.
- **Verify**: `bun run test:infra` = 71 node tests (+2) + 6 bun tests, all pass.

## 7. P15 — drop the unused `tailwindcss` devDependency — `aa49187`

- **Files**: `packages/ui-native/package.json`, `bun.lock`.
- **What**: removed `tailwindcss` from `packages/ui-native`; `bun install`
  updated exactly the one lockfile entry.
- **Why**: `grep tailwind packages/ui-native` matched only the declaration —
  consumers (`apps/mobile`, `apps/web`) bring their own Tailwind and the shared
  preset is in `@aulora/tokens`.
- **Measurement**: reasoned; one fewer heavy install and audit surface.
- **Verify**: `bun run --cwd packages/ui-native typecheck` + `lint` pass;
  `bun run --cwd apps/mobile typecheck` passes.

## 8. P21 — trim the Docker build context — `be45bd4`

- **Files**: `.dockerignore`.
- **What**: added `store-assets/` and `*.whl` (the three committed wheels at the
  repo root) and normalised the existing `spikes`/`docs` entries to directory
  form. `licenses/` stays because `web.Dockerfile`, `setup.Dockerfile` and
  `backup/backup.Dockerfile` COPY it.
- **Why**: ~6 MB of context was transferred and hashed on every repo-root image
  build though no Dockerfile references it.
- **Measurement**: reasoned; verified against every Dockerfile's `COPY` lines.
- **Verify**: `node scripts/check-release.mjs` passes (it reads `.dockerignore`);
  no Docker build was run here.

## 9. P3 — throttle updater progress events — `d2df500`

- **Files**: `apps/desktop/src-tauri/src/updater.rs`.
- **What**: the download callback emits the first chunk, then at most every
  ~100 ms, plus a final event when `downloaded` reaches `total`. `download()`,
  `install()` and minisign verification are untouched.
- **Why**: one `aulora://app-update-progress` IPC event per network chunk is
  hundreds-to-thousands of JSON emissions into the webview during install.
- **Measurement**: reasoned (no Rust toolchain target here). The callback
  signature was checked against `tauri-plugin-updater` 2.13.1
  (`FnMut(usize, Option<u64>)`) and the file parses under `rustc`.
- **Verify**: `bun run --cwd apps/desktop lint` and the release tests pass. Not
  compiled (no generated `icons/` + no `target/`; `tauri-build` needs them).

## 10. P4 + P6 — desktop crate types and bundle targets — `148da14`

- **Files**: `apps/desktop/src-tauri/Cargo.toml`,
  `apps/desktop/src-tauri/tauri.conf.json`.
- **What**: `[lib] crate-type` is now `["rlib"]` (the binary calls
  `aulora_desktop_lib::run()`); base `bundle.targets` is `["app"]` instead of
  `"all"` (the macos/windows/linux configs already opt into app+dmg / nsis /
  deb). `withGlobalTauri` is left untouched.
- **Why**: the desktop-only workspace compiled mobile `staticlib`/`cdylib`
  scaffolding it never links, and any base-config build produced every bundle
  format.
- **Measurement**: reasoned; Tauri merges the platform config by target, so the
  build wrapper is unchanged.
- **Verify**: `bun run --cwd apps/desktop lint` and `bun run --cwd apps/desktop
  verify` pass. Not compiled (see P3).

## 11. P20 — remote backup retention docs — `c6e5a25`

- **Files**: `infra/docker/backup/README.md`, `apps/docs/content/backups.md`.
- **What**: added a short "Remote retention" note recommending a MinIO/S3
  object-lifecycle rule for the backup prefix (`mc ilm rule add --expire-days
  30 local/aulora-backups`) and the caution that expiry removes recovery points
  and that `BACKUP_RETENTION` only prunes local directories.
- **Why**: object-storage backups accumulate unbounded on the same MinIO disk as
  uploads and search indexes; the failure is quiet and slow.
- **Measurement**: docs only, no behaviour change.
- **Verify**: `bun run docs:check` and `bun run test:infra` pass.

---

## Skipped / not attempted

None of the assigned items were skipped; every one landed and verified.

Deliberately not taken (out of scope or higher risk):

- **P16 subpath migration**: the `./avatar`/`./svg` exports are added, but no
  consumer was moved to them — `apps/web/src` and `apps/mobile/src` are off
  limits under this task's rules.
- **P3 memory**: only the progress throttle was made; streaming the installer to
  a temp file (the second half of P3) changes the `install` call path and needs a
  Windows check.
- **P18 brotli**: left commented because the pinned nginx image lacks the
  module.
- **Rust compilation**: the desktop changes were not compiled (no `icons/`,
  no `target/`); `verify-config` and the release tests are the local guards, and
  `tauri build` in CI remains the final authority.

## Final verification (HEAD = `c6e5a25`)

| Command | Result |
| --- | --- |
| `bun run --cwd apps/docs typecheck` | pass |
| `bun run --cwd apps/docs lint` | pass (pre-existing CSS warnings only) |
| `bun run --cwd apps/docs test` | pass (24 tests) |
| `bun run docs:check` | pass (63 guides + all generated links) |
| `bun run --cwd packages/{core,tokens,ui-web,ui-native} typecheck`+`lint` | pass |
| `bun run --cwd packages/avatars typecheck`+`lint` | pass |
| `bun run --cwd apps/web build` | pass |
| `bun run --cwd apps/mobile typecheck` | pass |
| `bun run test:infra` | pass (71 node + 6 bun) |
| `bun run --cwd apps/desktop lint` | pass |
| `bun test apps/desktop/scripts/release-*.test.mjs` | pass (4) |
| `bun run --cwd apps/desktop verify` | pass |
