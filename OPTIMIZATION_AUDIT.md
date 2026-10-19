# OPTIMIZATION_AUDIT.md

Resource-usage audit and optimization plan for Aulora, targeting 100,000+ users
on a single self-hosted workspace. Produced in four phases: research/audit, ranked
plan, implementation, verification.

## Scope and method

Every build target was reviewed: web client, mobile client, desktop shell, docs site,
shared packages, the Convex backend, and the deployment/infra layer.

- Four parallel read-only audits (backend, web, mobile, desktop/docs/shared/infra)
  read the source rather than guessing; each finding records `path:line` evidence.
- Web bundle figures come from a real production build (`vite build`, Vite 8.3.1 /
  rolldown); docs and asset sizes from `du`/`wc`; backend figures from reading the
  Convex query/mutation/cron code and estimating call volume at 100k users.
- The raw per-area working notes were `docs/optimization/findings-*.md`; their content
  is consolidated here and the intermediates were removed.

## 1. Architecture map

| Target | Framework / stack | Talks to backend via | Reads / writes |
| --- | --- | --- | --- |
| `apps/web` | Vite 8 + React 19.2 + TanStack Router 1.170 + Tailwind 3.4 | Convex websocket client (live queries + mutations), Better Auth over `/api/auth`, HTTP actions for file bytes | Channels, messages, threads, reactions, presence, typing, read states, members/roles, notifications, admin, kanban, notes, voice signalling |
| `apps/mobile` | Expo SDK 57 / RN 0.86, Expo Router, NativeWind 4.2, React 19.2 | Same Convex client, wrapped by `packages/core` `ChatSession`; expo-notifications for push | Same data set as web; additionally devices/push tokens and local media |
| `apps/desktop` | Tauri 2 shell embedding `apps/web/dist` (Rust `src-tauri`) | The embedded web client (no separate API) | Same as web; adds tray/menu/updater/deep links/badge |
| `apps/docs` | Hand-rolled zero-dependency static generator (`scripts/build.mjs`) | None (fully static) | Docs/landing content only |
| `packages/convex` | Convex 1.46 backend: schema, queries, mutations, HTTP routes, crons, server-side encryption (EKM) | — | The single source of truth: all tables below |
| `packages/core` | Shared TS: chat session, outbox, search index, voice state, permissions, unread math | Consumed by web + mobile | In-memory client state |
| `packages/ui-web`, `ui-native`, `avatars`, `tokens` | UI primitives / icon + avatar generation | n/a | n/a |
| `packages/bot-sdk`, `bot-sdk-python` | Bot libraries | Run inside `infra/bot-runner`, call Convex bot HTTP routes | Bot code/env/logs/channels |
| `infra/docker` | Compose: nginx web, Convex backend, Postgres, MinIO, LiveKit, Vault, bot-runner, backup | n/a | nginx serves the SPA + gzip; MinIO holds sealed file bytes |
| `infra/push-relay` | Node 22 service: APNs/FCM forwarder | Called by the backend to wake devices | Opaque push payloads |
| `infra/bot-runner` | Node supervisor, per-bot sandboxed processes | Polls Convex desired-state | Bot lifecycle |

**Data flow.** Clients open long-lived Convex subscriptions; the server decrypts
sealed content on read and seals on write, so every message body costs server CPU
per read. Files are stored as sealed bytes in Convex `_storage` (not in rows), with
metadata in the `files` table. One deployment is one workspace, so tables like
`members`, `presence`, `channels` and `messages` are workspace-wide with no tenant
sharding — a full-table collect is therefore *global*, not per-tenant.

## 2. Findings by area

Impact is rated for 100k users in one workspace. Effort and risk are per change.

### 2.1 Server CPU and memory

| ID | Finding | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| B1 | `notifications.unreadSummary` collects **every message in every joined channel** per recompute; subscribed app-wide (`notifications.ts:179-227`) | High | Med | Med |
| B2 | `members.list` full-collects members + one auth lookup + one `storage.getUrl` **per member**; subscribed by every client (`members.ts:263-279`, `lib/accountNames.ts:48-65`) | High | Med | Med |
| B3 | `presence.list` full-collects and decrypts the whole presence table; subscribed by every client, re-runs on each heartbeat (`presence.ts:152-167`) | High | Low-Med | Low |
| B4 | Presence heartbeat mutation does ~5-7 reads + 1 write, including a `recordLicenseActivity` whose writes are already idempotent (`presence.ts:87-113`, `lib/licenseActivity.ts:9-55`) | High | Med | Med |
| B5 | `presence.sweepStale` cron full-collects presence every 30 s (`presence.ts:196-218`, `crons.ts:11`) | High | Med | Low |
| B6 | `typing.set`/`clear` scan all rows for a channel (no `(channelId,userId)` index); 30 s purge scans the whole table (`typing.ts`) | Med-High | Low | Low |
| B7 | `readStates.set` collects the **entire channel history** to count mentions (`readStates.ts:12-31`) | High | Med | Med |
| B8 | `readStates.summary` filters `by_channel_created` by `threadRootId` instead of using the existing `by_channel_thread` index; N+1 permission loads (`readStates.ts:129-198`) | Med-High | Low | Low |
| B9 | `messages.threadInbox` scans the newest 1000 messages across **all** channels; subscribed everywhere (`lib/threadInbox.ts:165`) | High | High | Med |
| B10 | Notification recipient resolution full-collects `presence` + one prefs collect per member, **run twice per message** (`lib/messageRecipients.ts:126-164`, `notifications.ts:407-544`) | High | Med-High | Med |
| B11 | `calls.sweep` full-collects three tables every 30 s; `callSignals` has no time index (`calls.ts:479-521`) | Med-High | Med | Low |
| B12 | `calls.activeCalls` uses a post-index `.filter(status != ended)` over the whole `calls` table (`calls.ts:412-449`) | Med-High | Low-Med | Low |
| B13 | `channels.visibleMemberIds` resolves every member's permissions for one channel (`lib/channelHelpers.ts:265-304`) | Med-High | Med | Med |
| B14 | Role removal collects all members and patches in a loop (`roles.ts:187-194`) | Med | Med | Med |
| B15 | `channels.list` post-filters DMs in-query instead of by index (`channels.ts:132-136`) | Med | Low | Low |
| B16 | Admin queries (`instance.overview`, `auditLog.list`) full-collect files/members/channels/devices (`instance.ts:122-126`, `auditLog.ts:33`) | Med | Med | Low |
| B17 | License seat check reads up to 100k member rows every 30 min (`license.ts:59-70`) | Med | Low | Low |
| B18 | `rateLimits` grows without bound, written on every send/upload, no TTL (`lib/rateLimit.ts:45-67`) | Med | Low | Low |
| B19 | Sealed-value crypto re-runs HKDF `importKey`+`deriveKey` for **every** value; no per-scope `CryptoKey` cache (`lib/sse.ts:125-145`) | Med-High | Low | Low |
| B20 | `botEvents` outbox prune can delete at most 50k rows/hour but writes one row per message/reaction (`lib/botEvents.ts`, `crons.ts:18`) | Med | Low | Low |
| B21 | `files.getMany` re-loads the full permission context per file (roles + server) (`files.ts:326-339`) | Med | Low | Low |
| B22 | Notes search decrypts/indexes up to 2000 note bodies per search (`workspaceNotes.ts:163-181`) | Med | Med | Med |
| B23 | `auditLog` has no retention (`auditLog.ts`, `schema.ts:695-701`) | Low-Med | Low | Low |
| B24 | `botRuntime.trimLogs` collects all log rows per append (`botRuntime.ts:150-162`) | Low-Med | Low | Low |

### 2.2 Database reads

Covered by B1, B2, B3, B6, B7, B8, B9, B11, B12, B13, B15, B16, B17 above. The
recurring anti-pattern is **unbounded `.collect()` inside a query that every client
subscribes to** (`members.list`, `presence.list`, `notifications.unreadSummary`,
`messages.threadInbox`, `calls.activeCalls`). Because one deployment is one
workspace, these re-run on every write to a large table and are delivered to every
connected client.

### 2.3 Database storage

| ID | Finding | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| S1 | `rateLimits`: one permanent row per action/user and action/IP, no TTL (B18) | Med | Low | Low |
| S2 | `auditLog`: append-only, no retention (B23) | Low-Med | Low | Low |
| S3 | `presence`: rows persist after users go offline; never deleted (B5) | Med | Low | Low |
| S4 | `callSignals`: high-volume short-lived rows, cleaned only by full scan (B11) | Med | Med | Low |
| S5 | `botEvents`: intended 1 h outbox can exceed the 50k/hour prune ceiling (B20) | Med | Low | Low |
| S6 | `devices`: one row per install + push token, never expired (no `lastSeen` prune) | Low-Med | Low | Low |
| S7 | Sealed `ciphertext` fields carry ~1.33x base64 envelope overhead; note bodies capped at 100 KB per row | Low | High | Med |

Already good: file **bytes** live in `_storage`, not in rows; the plaintext original
is deleted after sealing; invites/join codes store only digests.

### 2.4 Network and bandwidth

| ID | Finding | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| W1 | Every channel opens a live message subscription at once (~200 queries, ~20k messages per tab) (`ChatProvider.tsx:303-338`) | High | Med | Med |
| W8 | `presence.list` O(all members) payload re-sent to every client on every heartbeat (`ChatProvider.tsx:202-207`) | High | Med | Med |
| W10/W11 | `messages.threadInbox` and `notifications.unreadSummary` subscribed app-wide (`ChatView.tsx:279,297`) | High | Med | Med |
| W6 | One 1.19 MB entry chunk (344 kB gzip); no route/feature splitting (`vite.config.ts`) | Med | Med | Low-Med |
| W17/P18 | No Brotli/precompressed assets, gzip level 1, no `immutable` on hashed assets | Low-Med | Low | Low |
| P1 | Desktop embeds 17 MB of web assets, 13.6 MB of it on-demand ML wasm/models | High | Med | Med |
| P7 | Docs loads ~58 KB JS on all 23 pages; most features used on 1-3 pages | Med | Low | Low |
| P8 | Env-reference page duplicates every description into `data-search` (141 KB page) | Med | Low | Low |

### 2.5 Client CPU and RAM

| ID | Finding | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| W2 | Mic meter emits a level every 33 ms into the **shared** voice context; whole chat tree re-renders ~30x/s during calls (`media.ts:157,192`, `VoiceProvider.tsx:461-526`) | High | Low-Med | Low |
| W3/M4 | Outbox ticker runs every 5 s even when empty and always mints a new context value (`ChatProvider.tsx:274-285`, mobile `:253-267`) | Med | Low | Low |
| W4 | Timeline is unvirtualized and grows without bound; no row is `React.memo`-ized (`MessageList.tsx`) | High | Med-High | Med |
| W5 | Inline `channelNames` array defeats the `RichText` parse memo for every row (`ChannelPane.tsx:179`) | Med | Low | Low |
| W7 | Owner update provider ticks every 5 s and rebuilds its context value (`WorkspaceUpdateProvider.tsx:43-52,195-197`) | Low-Med | Low | Low |
| W12 | Attachment object URLs leak on unmount (fallback thumbnail + lightbox) (`AttachmentView.tsx`) | Med | Low | Low |
| W14 | Member panel filter is `Array.includes` (O(n^2)) and unvirtualized (`ChatView.tsx:654-662`) | Med | Low-Med | Low |
| W15 | Auth token polled every 60 s for every signed-in user even with no call (`VoiceProvider.tsx:254-276`) | Low-Med | Low | Low |
| W13 | Kanban re-renders every second and maps every card (`use-board.ts:129-137`) | Med | Med | Low-Med |
| M1 | Mobile message rows never memoized; inline context; O(rows x messages) reply lookup (`MessageList.tsx:161-307`) | High | Med | Med |
| M2 | One live reaction subscription **per mounted row** (`ReactionRow.tsx:59-68`) | High | S-Med | Low-Med |
| M5 | Typing mutation per keystroke, no throttle, never cleared (web has a throttle) (`Composer.tsx:275-280`) | Med-High | S | Low |
| M6 | Full-size images downloaded and base64-encoded per visible thumbnail (`AttachmentView.tsx:52-68`) | Med | Med | Med |
| M7 | Members/channels/DMs are ScrollViews (no virtualization); all three panes always mounted | Med | Med | Med |
| M8 | Unmemoized `attachmentsByMessage` and whole-model prop threading | Med | Med | Low-Med |
| M9 | Voice level emits re-render the chat subtree 2-5 Hz | Med | S-Med | Med |
| M12 | Avatar SVG regenerated every render; remote avatars served full-size | Med | S-Med | Low |
| M13 | Unthrottled 4 s QueryErrorBoundary retry; unused deps/plugins; `callerName` effect dep | Low-Med | S | Low |
| M10/M11 | Mobile search re-pages the whole archive each session; one live subscription per history page | Med | Med | Med |

### 2.6 Bundle and app size

| ID | Finding | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| W6/P2 | Single entry chunk; admin (345 kB), kanban (161 kB), notes (106 kB), voice (199 kB), better-auth (~85 kB) all in the critical path | Med | Med | Low-Med |
| P1 | Desktop embeds ML wasm/models + a 1.4 MB notices file | High | Med | Med |
| P12 | No `sideEffects: false` anywhere; `@aulora/core` is a side-effectful mega-barrel (`packages/core/src/permissions.ts:56`) | Med | Low | Low-Med |
| P13 | `@aulora/core` has one root export; 165 web + 83 mobile import sites | Med | Med | Med |
| P15 | `packages/ui-native` depends on `tailwindcss` with no usage | Low | Low | Low |
| P16 | `@aulora/avatars` root export drags `blobatar/uri` into `<Avatar>`-only consumers | Low | Low | Low |
| P21 | Docker build context ships `store-assets/`, three root `.whl` files, `spikes/` (~6 MB) unused | Low | Low | Low |
| P3 | Desktop updater holds the whole installer in memory and emits an IPC event per chunk | Med | Low | Low |
| P4/P6 | Tauri compiles all platforms' features; base `targets: "all"` | Low | Low | Low |
| P9 | Docs build emits no minification or precompressed variants | Med | Low-Med | Low |
| P17 | Push relay re-signs an APNs JWT and reopens HTTP/2 per notification, no timeout | Med | Low | Med |
| P19 | Bot runner polls every 3 s even with zero bots | Low-Med | Low | Low |
| P5 | Update checks + a 5 s owner tick run per client, no jitter | Med/Low | Low | Low |
| P20 | Remote backup retention undefined (unbounded MinIO growth) | Med | Low | Low |

## 3. Ranked plan (impact vs effort)

Tier 1 items are low risk and clearly beneficial: no schema change, no API-contract
change, no stored-data removal and no user-visible behaviour change. These were
implemented in this pass. Tier 2 items do change one of those things and are
**deferred pending approval**.

### Tier 1 - implemented (low risk)

| Rank | IDs | Change | Impact | Effort |
| ---: | --- | --- | --- | --- |
| 1 | B19 | Cache derived `CryptoKey` per `(keyVersion, scope)` in `lib/sse.ts` | Med-High | Low |
| 2 | B8 | `readStates.summary` uses the existing `by_channel_thread` index; hoist permission context | Med-High | Low |
| 3 | B21 | `files.getMany` loads the permission context once per distinct channel | Med | Low |
| 4 | B12 | `calls.activeCalls` uses `by_status` instead of a post-index filter | Med-High | Low |
| 5 | B20/B24 | Larger `botEvents` prune budget; index-bounded `botRuntime.trimLogs` | Med | Low |
| 6 | W5/W4 | Hoist `channelNames`; `React.memo` the timeline rows and stable callbacks | Med-High | Low |
| 7 | W3/M4 | Outbox ticker idles when the queue is empty and no-ops on unchanged lists | Med | Low |
| 8 | W2 | Mic level meter emits only on a real change and at a display cadence | High | Low-Med |
| 9 | W12 | Revoke attachment object URLs on unmount (fallback + lightbox) | Med | Low |
| 10 | W7/P5 | Gate the owner ticker on an in-flight update; memoize its context value | Low-Med | Low |
| 11 | W14 | `Set` membership for the member panel filter | Med | Low |
| 12 | W15 | Poll the call auth token only while a call is active | Low-Med | Low |
| 13 | W6/P2 | Route/feature code splitting + vendor `manualChunks` | Med | Med |
| 14 | M1 | Reply index map + memoized rows/context in the mobile timeline | High | Med |
| 15 | M5 | Throttle typing and clear it on send (parity with web) | Med-High | Low |
| 16 | M12 | Memoize the generated avatar; `React.memo` the avatar component | Med | Low |
| 17 | M8 | `useMemo` the mobile attachments map; stable model slices | Med | Low |
| 18 | M7 | Presence `Map` + capped `HereNow` (no `find` in the sort comparator) | Med | Low |
| 19 | M13 | Gate the query-boundary retry on app state; `useCallback` the caller name | Low-Med | Low |
| 20 | W13 | Pause the kanban clock when the board is not visible | Med | Low |
| 21 | M9 | Emit voice levels only on change (avoid the 2-5 Hz subtree render) | Med | Low |
| 22 | P12/P16 | `sideEffects` flags + split `@aulora/avatars` exports | Med | Low-Med |
| 23 | P7 | Docs: per-feature dynamic imports instead of one 58 KB bundle | Med | Low |
| 24 | P8 | Docs: drop the duplicated `data-search` haystack; build it lazily | Med | Low |
| 25 | P9/P18/W17 | Precompressed assets + nginx gzip level/vary/immutable/brotli | Med | Low |
| 26 | P19 | Bot runner backs the poll interval off when no bots run | Low-Med | Low |
| 27 | P15/P21 | Remove the unused `tailwindcss` dep; trim the Docker build context | Low | Low |
| 28 | P3/P4/P6 | Throttle desktop updater progress; drop mobile crate types; default targets | Low-Med | Low |
| 29 | P20 | Document/apply remote backup retention | Med | Low |

### Tier 2 - deferred, needs approval

These change the schema, the client/server API contract, delete stored data, or
alter user-visible behaviour.

| IDs | Change | Why it needs approval | Impact |
| --- | --- | --- | --- |
| B1, W11 | Bound `unreadSummary` to a cursor+`take` (or a maintained counter) | Could saturate the badge (visible "99+") and changes the query shape | High |
| B2, W8, M3 | Paginate `members.list`; scope `presence` to visible users (`presence.getMany`) | API contract change; mention autocomplete/member panel must move to search-as-you-type | High |
| B3 | Client subscribes only to on-screen presence | API contract change shared by web + mobile + `core` | High |
| B4 | Lengthen presence tolerance / short-circuit license activity in the heartbeat | Changes staleness behaviour and licence accounting | High |
| B5 | Add `presence.by_lastHeartbeat` + batched sweep | Schema (index) change | High |
| B6 | Add `typing.by_channel_user` + `typing.by_expires`; batched purge | Schema change | Med-High |
| B7 | Bound the mark-read mention back-count | Possible mention-count drift (visible) | High |
| B9, W10 | Per-user thread participation (new table/index) for the inbox badge | New table + API; badge behaviour | High |
| B10 | Resolve message recipients once and index prefs by channel | Touches notification delivery semantics | High |
| B11, S4 | `callSignals.by_created` + indexed sweeps | Schema change | Med-High |
| B13 | Precompute channel visibility instead of resolving all members live | Risk of visibility/mention regressions | Med-High |
| B14 | Reverse index (`memberRoles`) for role detachment | Schema change + data backfill | Med |
| B15 | `channels` kind/archived index | Schema change | Med |
| B16 | Maintained counters/aggregate component for admin overview | New component (infra) + schema | Med |
| B17 | Maintained member-count field for the licence check | Schema change + backfill | Med |
| B18, S1 | TTL prune for `rateLimits` | Deletes stored data | Med |
| B22 | Bounded/debounced notes search; revision pruning by index | Behaviour + CPU tradeoff | Med |
| B23, S2 | `auditLog` retention cron | Deletes stored data | Low-Med |
| S3, S6 | Delete stale `presence` rows and old `devices` | Deletes stored data | Med-Low |
| W1 | Open only the active/recent channels, lazily load the rest | User-visible change to background loading + notification/sound logic | High |
| W4 | Virtualize the timeline (keep scroll anchoring / unread divider) | User-visible scroll behaviour | High |
| W8, M2 | Reaction summary on the message payload (drop per-row subscriptions) | API contract change | High |
| W13 | Paginate/stop decrypting kanban cards for the board view | API contract change | Med |
| M6 | Server-side thumbnail variants + `expo-image` | New asset pipeline / API | Med |
| M7 | Virtualize the mobile member/channel/DM lists | UX + scroll-restoration risk | Med |
| M10, M11 | Persist the mobile search index; snapshot older history pages | API/behaviour change | Med |
| M14 | Skip/group notifications for the channel the user is reading | User-visible notification behaviour | Med |
| P1 | Stop embedding the ML wasm/models in the desktop app; fetch per feature | Changes offline behaviour | High |
| P10, P11, P13, P17 | Docs search-index shape; docs release manifest; core subpath exports; push-relay JWT/connection reuse | Contract/medium-risk refactors | Med |

## 4. Implementation results

Tier 1 was implemented as **34 focused commits** (one optimization each) across
five areas, plus one lint fix. No schema change, no API-contract change, no
stored-data deletion and no user-visible behaviour change was made. Every
per-area change was verified with that target's typecheck, lint and tests before
committing; the whole repo was then run through `bun run check`.

### Measured before / after

| Metric | Before | After | How measured |
| --- | ---: | ---: | --- |
| Web entry JS chunk | 1,188,873 B (343,910 B gzip) | **76.78 kB (25.15 kB gzip)** | `bun run --cwd apps/web build` |
| Web heavy surfaces | all in entry chunk | `React.lazy` chunks: react 189.6 kB, ProfileSession 254.5 kB, AdminPanel 175.3 kB, KanbanView 84.5 kB, convex 75.1 kB, tanstack 74.1 kB, NotesView 63.6 kB, auth 30.9 kB, voice/call <6 kB each | same build |
| Docs JS loaded per typical page | 58,194 B (15,710 B gzip, 7 files) | ~12.6 KB (~4.4 KB gzip) | computed from `wc -c` of the emitted modules |
| Env-reference page | 141,481 B (14,432 B gzip) | 123,297 B (11,513 B gzip, +12.9% smaller) | docs build + `gzip -c` |
| Docs precompressed assets | none | 35 deterministic `.gz` siblings (level 9) | docs build |
| Backend sealed-value crypto ops | 2 extra WebCrypto ops (importKey + HKDF) per value | 0 after the first value per `(version, scope)` per invocation | code + tests |
| Mobile reply lookup | O(rows × messages) `find` per render | O(1) id→message map | code + tests |
| Mobile typing mutations | 1 per keystroke | ≤ 1 per 3 s + explicit clear | code + tests |

Client re-render and server read-count changes (row memoization, outbox/idle
ticks, mic-level quantization, indexed reads) are behaviour-preserving by
construction and were reasoned from the code rather than benchmarked here; the
existing suites (including the message-list scroll/unread and outbox tests)
guard them. Section 6 lists the metrics to watch to confirm the gains in
production.

### Per build target

**Backend (`packages/convex`) — 6 commits.** `ec58a62` per-scope `CryptoKey`
cache (B19); `02b1944` `readStates.summary` uses `by_channel_thread` and hoists
the permission context (B8); `5601034` `files.getMany` batches access checks
(B21); `0e3312c` `calls.activeCalls` reads `by_status` (B12); `4b98cb7`
`botEvents.prune` drains until caught up (B20); `e96743c` `botRuntime.trimLogs`
avoids the full collect (B24). Tests: 59 files / 572 tests.

**Web (`apps/web`) — 10 commits.** Row memoization + hoisted props (W4/W5,
`579173f`); idle outbox ticker (W3, `c1d4346`); mic-level quantization (W2,
`3fc1432`); object-URL revocation (W12, `339f07c`); owner-tick gating (W7,
`dd61487`); `Set` membership filter (W14, `768401a`); call-token gating (W15,
`85ebf44`); kanban clock pause (W13, `8362029`); update-check jitter (P5,
`4a4f2ef`); code splitting + vendor chunks (W6, `e24384a`). Tests: 66 files /
515 tests.

**Mobile (`apps/mobile`) — 8 commits.** Idle outbox flush (M4, `31b5ad2`);
typing throttle + clear (M5, `2b61cf9`); avatar memoization (M12, `b1bfde5`);
message-list reply index + memoized rows (M1, `ef3f7f8`); memoized attachment
map (M8, `650ad4f`); indexed here-now presence (M7, `73714f7`); background-timer
gating (M13, `4d2a689`); voice-level quantization (M9, `0573d29`). Tests: 22
files / 142 tests.

**Platform (`apps/docs`, `apps/desktop`, shared packages, `infra`) — 11
commits.** Docs per-feature lazy JS (P7, `7b5b14e`); env-reference `data-search`
removal (P8, `63e11b7`); docs precompression (P9, `bae2ed5`); nginx
gzip/vary/static/immutable (P18/W17, `552b60b`); `sideEffects` + avatars
subpaths (P12/P16, `933e7dc`); adaptive bot-runner polling (P19, `dbcfa7e`);
unused `tailwindcss` removal (P15, `aa49187`); `.dockerignore` trim (P21,
`be45bd4`); updater progress throttle (P3, `d2df500`); desktop crate types /
bundle targets (P4/P6, `148da14`); remote-backup retention docs (P20, `c6e5a25`).
`a348316` sorts the docs build imports (lint fix). Infra tests: 71 node + 6 bun.

Supporting reports with per-item evidence: `docs/optimization/impl-backend.md`,
`impl-web.md`, `impl-mobile.md`, `impl-platform.md`; raw per-area audits:
`docs/optimization/findings-*.md`.

### Verification status

`bun run check` (lint + typecheck + test + build + infra tests + release tests +
`docs:check` + `release:check`) **passes against the branch (exit 0)**: all turbo
tasks green (12/12 lint, 11/11 typecheck, 11/11 test, 3/3 build). After the Tier 2
waves the counts grew to 589 backend + 532 web + 149 mobile tests, 75+6 infra
tests, 29 release-script tests and 13 Play-upload tests, plus the docs link
checker; the only "failed" lines in the log are the intentional Play-upload
timeout/retry fixtures. The desktop Rust target was not compiled locally (no
toolchain/target here); `tauri build` in CI remains the final authority for
`src-tauri` changes.

## 5. Migrations and rollout order

**Tier 1 needs no migration and no downtime.** It changes only query
implementation, client component structure, build/serving config and docs; no
table, index, field or stored value changed, and no API shape changed. It can be
deployed with a normal release (rebuild the `web`/`setup` images, run `setup`,
recreate `web`; `convex deploy` for the functions).

**Tier 2 (deferred) migration order, if approved.** Convex index additions are
additive and zero-downtime (the deploy registers the index and backfills it in
the background; queries start using it when ready). Recommended order so that no
deploy depends on a not-yet-backfilled index:

1. Add pure indexes and read-only fields first, deploy, wait for backfill, then
   deploy the code that queries them: `presence.by_lastHeartbeat` (B5),
   `typing.by_channel_user` + `by_expires` (B6), `callSignals.by_created` (B11),
   `channels` kind/archived index (B15), `rateLimits` window index (B18).
2. New tables requiring a backfill (batched migration mutation, resumable, safe
   to re-run): `memberRoles` reverse index (B14) and per-user thread
   participation (B9) — backfill from `members.roleIds` and message mentions,
   then switch reads.
3. Maintained counters/fields (`memberCount` on `server` (B17), channel
   visibility (B13), admin overview counters (B16)): seed from a one-off count,
   then maintain on the write paths.
4. Behavioural changes (B1 bounded/derived unread, B2/B3 paginated members and
   scoped presence, B7 bounded mention count, B10 recipient resolution, W1
   channel laziness, W4 virtualization, W8/M2 reaction summaries, M6 thumbnails)
   each require a client + server deploy in that order (server first when it is
   additive), with a feature flag or dual-read where the payload shape changes.
5. Data deletion (S1 `rateLimits` TTL, S2 `auditLog` retention, S3/S6 stale
   `presence`/`devices`) must ship as bounded, resumable, retention-windowed
   crons that can be disabled to revert. Take a backup first; deletions are the
   only irreversible Tier 2 items.

No new infrastructure is introduced by Tier 1. Tier 2 should avoid new services:
Convex scheduled functions already cover the sweeps, and Convex indexes cover the
read paths; the only case that could justify a component is admin aggregates
(B16), and a maintained counter is cheaper than a new one.

## 6. Monitoring at scale

Watch these at 100k users; each maps to a finding above.

**Server (Convex) — the first place trouble shows.**
- Per-function document-read counts, especially `notifications.unreadSummary`,
  `members.list`, `presence.list`, `messages.threadInbox`, `calls.activeCalls`.
  Alert if any single call exceeds ~a few thousand reads (sign of an unbounded
  collect). Target after Tier 2: bounded by page size.
- Function invocations/sec and reactive-query re-run rate. At 100k users the
  presence heartbeat alone is ~3,300 invocations/sec; a sustained multiple of
  that (or re-runs far above write volume) means an over-broad subscription.
- Scheduled-job duration: the 30 s `presence`, `typing` and `calls` sweeps must
  finish in well under 30 s. Alert if run time approaches the cadence — it means
  the sweep is scanning a table that grew without an index (B5/B6/B11).
- Transaction-size / read-limit errors: any occurrence means a collect crossed a
  Convex limit (B2/B16 at scale).
- CPU time per function p95; alert on a rising trend after deploys.

**Database.**
- Row counts and growth rate for `messages`, `auditLog`, `rateLimits`,
  `presence`, `callSignals`, `botEvents`, `devices`, and `_storage` bytes.
  Flat or bounded tables are healthy; a line that never flattens is a missing
  TTL (S1-S6). Storage quota is the user-visible risk (`instanceSettings`).
- Index backfill status after any Tier 2 schema deploy; do not enable the new
  query path until backfill completes.
- File egress and average sealed-file size.

**Clients.**
- Web: entry + lazy chunk sizes in CI (budget the entry under ~200 kB raw),
  long tasks / INP, JS heap, and the count of live Convex subscriptions per tab
  (target ≤ ~20 after W1). Alert on a growing heap in a long-lived tab (W4/W12).
- Mobile: JS-thread FPS and memory during scroll and during calls, typing
  mutation rate, background wakeups. Avatars/attachments dominate memory (M6/M12).
- Desktop: install/update payload size (P1 — currently ~17 MB with ML assets)
  and cold-start time.

**Network / edge.**
- p95 query payload bytes and per-client egress; a full `presence`/`members`
  payload per heartbeat is the warning sign (W8/M3).
- Compression ratio and cache hit rate on `/assets/` (P18/W17): expect ~5x gzip
  and near-100% hits on hashed assets; misses mean the immutable/caching config
  regressed.
- Push relay APNs/FCM latency and error rate; a rising error rate with pending
  requests points at the missing timeout / connection reuse (P17).
- Docs: `.gz` served (check `Content-Encoding`), GitHub API fallback rate-limit
  failures (P11).

## 7. Tier 2 implementation results (approved)

All five approved groups were implemented, in dependency order, as focused
commits with per-target verification. Schema/index additions are additive and
zero-downtime; the client-visible changes were staged server-first.

### 7.1 Schema, bounded sweeps and retention (additive)

| ID | Change | Commit |
| --- | --- | --- |
| B5 | `presence.by_lastHeartbeat` + cursor-batched stale sweep (no full collect) | `1582d1c` |
| B6 | `typing.by_channel_user` + `by_expires`; indexed set/clear + bounded purge | `53526b9` |
| B11 | `callParticipants.by_lastSeen`, `callSignals.by_created`; indexed call sweeps | `0753f96` |
| B15 | `channels.list` reads non-DM channels by the existing `by_dm_key == undefined` index instead of post-filtering | `738c445` |
| B18+S1 | `rateLimits.by_window_start` + hourly `pruneRateLimits` TTL | `f11371f` |
| B17 | `server.memberCount` maintained + `internal.maintenance.backfillMemberCount` | `0ed3f1a` |
| S2 | Daily 180-day `pruneAuditLog` | `3e11919` |
| S3+S6 | 30-day `pruneStalePresence`, 180-day `pruneStaleDevices` (new `devices.by_lastSeen`) | `56d6551` |
| B14 | `memberRoles` reverse table (dual-write) + `backfillMemberRoles`; `roles.remove` by `by_role` | `c83f829` |
| B9 | `threadParticipants` table + `backfillThreadParticipants` | `c67c4eb` |

### 7.2 Bounded read paths (no API-shape change)

| ID | Change | Commit |
| --- | --- | --- |
| B1 | `unreadSummary` reads a saturating 100-row tail per channel after the read cursor | `dd762b1` |
| B9 | `threadInbox` reads `threadParticipants.by_user` (bounded) instead of the global 1000-message scan | `773b8c0` |
| B10 | Notification recipients resolved once per message; presence looked up by candidate id; prefs in one pass | `e56a9ea` |
| B4 | Heartbeat reuses the member row; `recordLicenseActivity` short-circuits when unlicensed | `1cab62b` |
| B7 | Mark-read mention count reads a bounded range after the cursor | `3898fcf` |
| B13 | `visibleMemberIds` memoizes role-set resolution | `426796e` |
| B16 | `instanceSettings` maintained counters (+ `backfillInstanceCounters`); `auditLog.list` resolves only page nicknames | `5b436d7` |
| B22 | Notes search capped at 300 pages; revision prune by index range | `c0e6354` |

### 7.3 New additive client APIs

`api.members.page({cursor,numItems})` (default 100, cap 500, `by_joined`);
`api.members.search({query,limit})` (default 25, cap 100, bounded 500-row window);
`api.presence.getMany({userIds})` (deduped, cap 300); `presence.list` now has a
1000-row safety bound. Commits `294602c`, `99f2803`, `fbb2d8a`, `07cb045`.

### 7.4 Client fan-out

- **Web** (`a67996a`): scoped `presence.getMany` (cap 300) replaces the
  whole-table `presence.list` subscription; single map build per update.
- **Web** (`3be780f`): eager channel subscriptions bounded to
  `EAGER_CHANNEL_OPEN_CAP = 8` (unread/mentioning first); background chimes/OS
  notifications now diff the already-subscribed `readStates.summary`.
- **Mobile** (`9481b16`): scoped presence (cap 300); the duplicate presence
  subscription in `ChatSession.start` removed.
- **Mobile** (`330649a`): one batched reaction subscription per timeline instead
  of one live query per row.
- **Mobile** (`6fc1073`): local notifications skip/clear the channel being read.
- **Mobile** (`6cd69c0`): incremental search indexing (seen-id set) + bounded
  backfill (12 × 200).
- **Mobile** (`6132823`): one live history subscription; older pages fetched as
  snapshot prepends.
- **Web** (`3823692`): bounded timeline window (`MAX_RETAINED_PAGES = 12`,
  ~1,200 messages) with a visible history seam.

### 7.5 Media/pipeline and medium refactors

- **M6** (`ab8df76`): `files.thumbnailStorageId` + a sealed 320 px variant;
  `finalize` accepts it and `get`/`getMany` return `thumbnailUrl`; web and mobile
  upload and render the thumbnail inline instead of the full original.
- **P1** (`99b452d`, corrected `95e586e`): desktop embed drops only the
  duplicated legal notices (17 MB → 15.2 MB). The larger 13.6 MB ML-asset win was
  reverted because it silently disabled background blur/noise suppression under
  the shell's no-remote-code CSP — a UX regression, not an offline-only tradeoff.
- **P17** (`673873b`): push relay caches the APNs JWT (45 min), reuses HTTP/2
  sessions, adds request timeouts and an in-flight cap.
- **P11** (`e33a076`): docs prefer the static `latest.json` manifest over the
  unauthenticated GitHub API (API kept as fallback).
- **P13** (`8022001`): `@aulora/core` gained subpath exports (root kept); one
  consumer migrated.

### 7.6 Deferred, with the reason

| Item | Why deferred | Concrete plan |
| --- | --- | --- |
| **B2 remainder** — paging the member panel/mention picker off `members.list` | `members.list` also feeds display names for off-page timeline authors and client-side `@everyone`/`@role` broadcast expansion (which would need all ids and would store a 100 k-element array on a message). Paging alone regresses both. | (1) Add `members.names({userIds})` (bounded, id→display name) for rendered authors; (2) represent broadcasts symbolically (`mentionEveryone`/`mentionRoleIds` on messages) and resolve recipients server-side; (3) then move the panel/pickers to `members.page`/`members.search` and retire `members.list`. Needs a message-format + notification change, so its own PR. |
| **P1 full 13.6 MB desktop win** | Requires relaxing the shell's no-remote-code CSP or a Rust local-asset download path; unverifiable without a Rust toolchain. | Deliberate CSP (`script-src`/`worker-src` for the workspace origin) or download-to-local-custom-protocol; needs a security sign-off. |
| **P13 breadth** | `sideEffects: false` already tree-shakes the root barrel; migrating every import site is a large mechanical diff with little remaining gain. | Migrate heaviest consumers (`chat`, `voice`, `notes`, `kanban`) incrementally. |
| **W4 full virtualization** | A virtualizer risks subtle scroll-anchor/unread-divider regressions. | The bounded window shipped bounds the DOM; adopt `@tanstack/react-virtual` later behind the existing scroll tests. |
| **W10/W11 badge counters, M6 CDN stage** | Server bounds landed; a maintained badge counter / edge thumbnail CDN are further steps. | Separate follow-ups. |

### 7.7 Migrations to run after deploying Tier 2 (order)

Convex applies the additive indexes automatically. Run the backfills once, in
this order (all idempotent and self-rescheduling; safe to re-run):

1. `npx convex run maintenance:backfillMemberCount`
2. `npx convex run maintenance:backfillMemberRoles`
3. `npx convex run maintenance:backfillThreadParticipants`
4. `npx convex run maintenance:backfillInstanceCounters`

Until (1)/(2)/(4) run, `license.ts`, `roles.remove` and `instance.overview` keep
their original fallbacks, so a partial rollout is safe. The retention crons
(rate-limits TTL, audit-log 180-day, presence 30-day, devices 180-day) begin
deleting only data outside their windows; take a backup before first deploy if
you want the option to revert the deletions.
