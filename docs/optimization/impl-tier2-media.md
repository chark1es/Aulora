# Tier-2 media / asset-size optimizations — implementation report

Branch: `t3/scale-resource-optimization`. Scope: the media/asset-size items
approved from the Tier-2 list — **M6** (thumbnail variant), **P1** (desktop
embed), **P17** (push-relay efficiency), **P11** (docs release manifest) and
**P13** (core subpath exports). Each item is one focused commit; the affected
target's checks were run after every commit, and the whole repo was run through
`bun run check` at HEAD. No new runtime npm dependency was added.

## Status

| # | Finding | Status | Commit |
| --- | --- | --- | --- |
| 1 | M6 — server thumbnail variant (web + mobile + backend) | **landed** | `ab8df76` |
| 2 | P1 — desktop stops embedding on-demand ML effect assets | **landed (smaller safe win; effects tradeoff documented)** | `99b452d` |
| 3 | P17 — push relay token/connection reuse + request bounds | **landed** | `673873b` |
| 4 | P11 — docs prefer a static release manifest over the GitHub API | **landed** | `e33a076` |
| 5 | P13 — `@aulora/core` subpath exports | **partial (subpaths added; one consumer migrated)** | `8022001` |

Measured before/after (where measurable):

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Desktop embedded frontend | 17 MB (`apps/web/dist`) | **2.3 MB** (`apps/web/dist-desktop`) | `du -sh` + `prepare-frontend.mjs` report (14.8 MB smaller) |
| Inline image preview | full original (re-encoded up to 4096 px; disk original up to the 25 MB cap) | 320 px thumbnail variant (~1/64 the pixels) | `apps/web/src/lib/image.ts`, `apps/mobile/src/lib/attachments.ts` |
| Docs download data source | unauthenticated GitHub **API** per visitor | static `latest.json` (no API), API only as fallback | code + tests |

---

## 1. M6 — thumbnail variant (`ab8df76`)

- **Files:** `packages/convex/convex/schema.ts`, `files.ts`, `http.ts`,
  `packages/convex/test/files.test.ts`, `packages/core/src/chat/port.ts`,
  `attachments.ts`, `chat/session.ts`, `chat/testing.ts`,
  `packages/core/test/chat-session.test.ts`, `apps/web/src/lib/attachments.ts`,
  `apps/web/src/lib/convex-chat.ts`, `apps/web/src/test/attachment-view.test.tsx`,
  `apps/mobile/src/lib/attachments.ts`, `apps/mobile/src/lib/convex-chat.ts`,
  `apps/mobile/src/components/chat/AttachmentView.tsx`.
- **Before:** the web grid fell back to the original image whenever no thumbnail
  was available, and mobile downloaded the full original and base64-encoded it
  into a `data:` URI **per visible row** (`AttachmentView.tsx`). The web image
  pipeline already produced a 320 px thumbnail but `uploadFiles` discarded it,
  and the `files` schema had no thumbnail field.
- **What:** `files.thumbnailStorageId` (optional `_storage` id) stores a
  server-sealed thumbnail variant. `finalize` accepts an optional
  `thumbnailStorageId`, seals it with the same `file.bytes` scope bound to a
  derived record id (`<storageId>:thumb`, so no extra column is needed), caps it
  at 1 MB and deletes the plaintext upload. `files.get`/`getMany` return
  `thumbnailUrl` (a signed variant URL); `http.ts` serves `?variant=thumbnail`
  and returns the original when a row has no thumbnail. `StoredFileView` gained
  `thumbnailUrl`; `descriptorFromStoredFile` now sets
  `AttachmentDescriptor.thumbnail` with that URL.
- **Web:** `uploadFiles` now uploads the existing `processAttachmentFile`
  thumbnail (a second `generateUploadUrl` PUT) and passes its storage id to
  `finalize`; `loadThumbnailUrl` fetches the server thumbnail URL directly. A
  thumbnail upload failure is swallowed so the attachment still uploads.
- **Mobile:** `processImage` builds a 320 px JPEG preview with the existing
  `expo-image-manipulator` handle and uploads it alongside the original; the
  inline `AttachmentThumb` renders the thumbnail **cached as a file** (no
  full-size base64), and the original is fetched only when the reader opens the
  preview (`loadFull`).
- **Backward compatible:** old records (and non-image uploads) keep
  `thumbnailUrl: null`; the client falls back to the original exactly as before.
  All existing `finalize`/`get`/`getMany` arguments and meanings are unchanged.
- **Tests:** backend asserts the variant is sealed/stored/returned and that a
  missing thumbnail falls back to the original; core asserts the descriptor
  carries the thumbnail URL and omits it when absent; web asserts the inline
  `<img>` uses the server thumbnail without downloading the original.

## 2. P1 — desktop embed (`99b452d`)

- **Files:** `apps/desktop/scripts/prepare-frontend.mjs` (new),
  `prepare-frontend.test.mjs` (new), `verify-config.mjs`, `package.json`,
  `src-tauri/tauri.conf.json`, `apps/web/biome.json`, `.gitignore`.
- **Before:** `frontendDist` was `../../web/dist` (17 MB), of which 13.4 MB is
  MediaPipe/RNNoise wasm + the selfie `.tflite` model used only for background
  effects/noise suppression, plus a 1.4 MB duplicate of the `legal/` notices the
  Tauri bundle already ships as resources.
- **What:** `prepare-frontend.mjs` copies `apps/web/dist` to
  `apps/web/dist-desktop`, skipping `assets/vision_wasm_*`,
  `assets/vision_bundle-*`, `assets/selfie_segmenter_*`,
  `assets/rnnoise-*`/`assets/rnnoise_*` and `legal/`. `frontendDist` points at
  `dist-desktop`; `beforeBuildCommand` builds the web bundle then runs the
  filtered copy. Measured embed: **17 MB → 2.3 MB (14.8 MB smaller)**.
- **Guardrails:** `verify-config.mjs` checks the `dist-desktop` target, the two
  build commands and that the prepare script still excludes each asset family;
  `prepare-frontend.test.mjs` covers the exclusion predicate and the copy.
- **Tradeoff (the pre-authorized smaller safe win):** the desktop build no
  longer carries the call-effect assets, so background blur/segmentation and the
  RNNoise denoiser degrade gracefully (the mic pipeline still works, video still
  connects) instead of running. Serving them from the workspace origin — the
  primary P1 idea — is **not** safe under the current shell policy: the effect
  JS (the MediaPipe wasm loader and the RNNoise/noise-gate worklet modules) is
  loaded as script/worker code, and the no-remote-code CSP
  (`script-src 'self' 'wasm-unsafe-eval'`, no `worker-src`) forbids loading it
  cross-origin. `connect-src https:` only helps the wasm/module **fetches**.
  Making online effects work again needs a deliberate CSP relaxation
  (`script-src`/`worker-src` for the workspace origin) and a version-matched
  asset path, or shipping the assets again. Documented as follow-up.
- **Verification:** `bun run --cwd apps/web build`, `bun run --cwd apps/desktop
  lint`, `bun run --cwd apps/desktop verify`, `bun test apps/desktop/scripts/*.test.mjs`
  all green. The Rust/Tauri binary cannot be compiled here (no toolchain); CI
  `tauri build` remains the final authority for the config change.

## 3. P17 — push relay efficiency (`673873b`)

- **Files:** `infra/push-relay/src/providers.mjs`, `src/server.mjs`,
  `test/relay.test.mjs`.
- **What:** (a) the APNs provider JWT is cached per `teamId:keyId` with a
  45-minute TTL, inside Apple's one-hour rotation window, so bursts reuse one
  token; (b) a shared HTTP/2 requester keeps one session per origin, reconnects
  on error/GOAWAY, drains each response and drops a timed-out session; (c) every
  APNs/FCM request carries `AbortSignal.timeout(10_000)`; (d) the server wraps
  deliveries in a bounded in-flight limiter (default 64 in flight, 512 queued)
  that sheds excess load with a retryable 503.
- **Contract:** `/v1/wake`, its auth, validation and response shapes are
  unchanged.
- **Tests:** token reuse + refresh, one session per origin, stalled-request
  timeout, the FCM timeout signal, the limiter bound and the server 503 path; the
  existing relay tests are unchanged. `bun run test:infra` → 75 node + 6 bun
  tests green.

## 4. P11 — docs release manifest (`e33a076`)

- **Files:** `apps/docs/static/downloads.js`, `apps/docs/lib/downloads.test.mjs`,
  `apps/desktop/scripts/release-manifest.mjs`, `scripts/ci/assemble-release.mjs`.
- **What:** `loadRelease` now tries static manifests first — the docs origin's
  `/downloads/latest.json`, then the release's published `latest.json` — before
  the GitHub API, keeping the sessionStorage cache and the `{tag_name, assets}`
  button contract. `assemble-release.mjs` adds an `assets` list (every installer
  and package URL) to the manifest it already writes; `buildReleaseManifest`
  accepts and validates it and the desktop updater ignores it. The docs path is
  inert until a manifest is published there, at which point it avoids the
  rate-limited API; without one, behaviour is exactly the previous GitHub path.
- **Tests:** manifest→assets conversion, `platforms` fallback, empty-manifest
  rejection, static-first preference (API not called), API fallback and the
  session cache. `bun run --cwd apps/docs test` → 30 tests;
  `bun run docs:check` green; `bun run test:release` still green.

## 5. P13 — core subpath exports (`8022001`)

- **Files:** `packages/core/package.json`, `apps/web/src/lib/image.ts`.
- **What:** added `./attachments`, `./blurhash`, `./chat`, `./kanban`,
  `./notes`, `./outbox`, `./permissions`, `./search`, `./updates`, `./voice`
  exports while keeping the root `.` export, so no existing import breaks. The
  one clearly-isolated consumer, the web image pipeline, now imports
  `blurhashDecode`/`blurhashEncode` from `@aulora/core/blurhash`.
- **Why only one consumer:** `@aulora/core` already sets `sideEffects: false`
  (Tier 1), so bundlers tree-shake the root barrel to the symbols actually used;
  the subpaths are the durable seam, but mass-migrating 248 import sites buys
  little bundle size and risks churn, so it is left as follow-up.

## Deferred / partial

- **P1 online effects:** cannot be made safe under the current no-remote-code
  CSP; needs a deliberate `script-src`/`worker-src` change plus version-matched
  effect assets (or shipping them again). The embed win (14.8 MB) landed.
- **P13 breadth:** only `blurhash` migrated; `sideEffects: false` already prunes
  the root barrel, so the remaining imports are untouched.

## Final verification (HEAD)

`bun run check` (lint + typecheck + test + build + `test:infra` + `test:release`
+ `docs:check` + `release:check`) passes at HEAD. Per target: backend 60 files /
589 tests; core 24 / 334; web 69 / 530 plus a production build; mobile 23 / 149;
desktop lint + config verification + 7 script tests; infra 75 node + 6 bun
tests; release 29 bun + 13 Play tests; docs 30 tests and the 69-guide link
check. The desktop Rust target was not compiled here (no toolchain); CI
`tauri build` validates it.
