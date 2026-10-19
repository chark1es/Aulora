# Web client optimization implementation

Branch: `t3/scale-resource-optimization`. One focused commit per item. No schema,
API-contract, data or UX-behaviour changes; the scroll-anchoring and
unread-divider tests continue to pass.

Verification run after every commit (from the repo root):

```
bun run --cwd apps/web typecheck   # tsc --noEmit
bun run --cwd apps/web lint        # biome check .
bun run --cwd apps/web test        # vitest run
```

All three pass on the final commit: typecheck clean, lint `Checked 351 files …
No fixes applied`, tests `66 files / 515 tests passed`.

| # | Item | Status | Commit |
| --- | --- | --- | --- |
| 1 | W5 + W4 (memoization) | landed | `579173f` |
| 2 | W3 | landed | `c1d4346` |
| 3 | W2 | landed | `3fc1432` |
| 4 | W12 | landed | `339f07c` |
| 5 | W7 | landed | `dd61487` |
| 6 | W14 | landed | `768401a` |
| 7 | W15 | landed | `85ebf44` |
| 8 | W13 | landed | `8362029` |
| 9 | P5 (web part) | landed | `4a4f2ef` |
| 10 | W6 | landed | `e24384a` |

---

## 1. W5 + W4 (memoization only) — `579173f`

- **Files**: `apps/web/src/components/chat/ChannelPane.tsx`,
  `apps/web/src/components/chat/MessageList.tsx`,
  `apps/web/src/components/chat/SystemEventRow.tsx`,
  `apps/web/src/components/chat/message-menu.tsx`.
- **What**: hoisted `props.channelMentions.map(e => e.name)` into a `useMemo`
  keyed on `props.channelMentions`, and stabilised the seven inline row
  callbacks (retry/discard, channel-click, reply, reply-to, edit, delete,
  pin, react) with `useCallback`. Added a `MessageRowListProps` slice of the 24
  fields the rows read, built once per list render with `useMemo`, and wrapped
  `TimelineRow` and `MessageRow` in `React.memo`.
- **Rows stabilised**: **2** row components (`TimelineRow`, `MessageRow`); the
  memoized prop slice has **24** fields and the parent now holds **7** stable
  callbacks plus **1** hoisted array.
- **Why (performance impact)**: previously the inline `channelNames` array was a
  new reference every render, so `RichText`'s `useMemo(parseRichText…)` never
  held, and every list state change (typing tick, reaction, voice snapshot)
  re-rendered every mounted row. Now a row re-renders only when its own item,
  reactions or the row slice change. No DOM structure, keys or scroll logic
  changed.
- **Measurement**: reasoned (no row-render counter); covered by the existing
  `message-list-*` tests.
- **Verify**: the three commands above; all pass.

## 2. W3 — `c1d4346`

- **Files**: `apps/web/src/providers/ChatProvider.tsx`.
- **What**: the 5 s retry ticker now skips `flush()`/`refreshOutbox()` entirely
  when no non-failed item is queued (the in-memory list is tracked in a ref,
  since `Outbox` only exposes an async `pendingCount()`). Added `sameOutbox`,
  which compares by id/status/attempts/lastAttemptAt/nextAttemptAt, so
  `setOutbox` keeps the previous array reference when nothing changed.
- **Why**: `Outbox.list()` always returns a fresh sorted copy, so an empty queue
  still minted a new `ChatContextValue` and re-rendered every `useChat()`
  consumer every 5 s. Now the context value is stable while idle. Queued items
  still retry every tick and on the `online` event.
- **Measurement**: reasoned; the connection-recovery tests still pass.

## 3. W2 — `3fc1432`

- **Files**: `apps/web/src/lib/voice/media.ts`,
  `apps/web/src/lib/voice/call-engine.ts`.
- **What**: the analyser is now sampled every 100 ms (was 33 ms) with the decay
  constant retuned (`0.37`) to keep the same visual fall rate; the engine rounds
  the level to whole percent and only calls `emit()` when the rounded level or
  `localSpeaking` changed since the last emit.
- **Why**: the meter pushed a new snapshot into the shared voice context ~30×/s,
  re-rendering the whole chat tree for the duration of a call. Context shape and
  the speaking hysteresis are unchanged.
- **Measurement**: reasoned; `call-speaking` / device-settings tests pass.

## 4. W12 — `339f07c`

- **Files**: `apps/web/src/components/chat/AttachmentView.tsx`.
- **What**: the lightbox object URL is tracked in `fullUrlRef` and revoked on
  close **and** on unmount; async loads are guarded by a `mountedRef` so a URL
  that resolves after unmount is revoked immediately; the no-thumbnail fallback
  effect now keeps the resolved URL in a local and revokes it in its cleanup,
  mirroring the primary thumbnail path.
- **Why**: `openFull` and the fallback were the two paths that never released
  their blobs, leaking full-size images for the tab's lifetime when the user
  scrolled away with the lightbox open. A URL still displayed is never revoked.
- **Measurement**: reasoned; `attachment-view` tests (including release on
  unmount) pass.

## 5. W7 — `dd61487`

- **Files**: `apps/web/src/providers/WorkspaceUpdateProvider.tsx`.
- **What**: replaced the owner-only 5 s `setInterval(() => setNow(...))` with a
  single `setTimeout` armed at `hostSeenAt + 30s`, re-armed only when the
  heartbeat timestamp changes. `now` is also stamped when a release check
  completes. `install`/`send`/`checkNow` are now `useCallback`s and both
  `settings` and the context value are `useMemo`ized.
- **Why**: the tick re-rendered the provider (and therefore `ChatViewContent`
  and the timeline) every 5 s for owners even with no update in flight, and the
  inline context value recreated the `settings` element each render.
- **Measurement**: reasoned; `workspace-updates` tests pass.

## 6. W14 — `768401a`

- **Files**: `apps/web/src/components/chat/ChatView.tsx`.
- **What**: build a `Set` from `visibleMemberIds` inside the existing `useMemo`
  and filter with `.has()` instead of `(… as readonly string[]).includes(…)`.
- **Why**: the member visibility filter was O(members × visibleIds) per render.
  Same members, same order; only the membership test changed.
- **Measurement**: reasoned.

## 7. W15 — `85ebf44`

- **Files**: `apps/web/src/providers/VoiceProvider.tsx`.
- **What**: gated the token fetch + 60 s refresh interval on `callActive`
  (`snapshot.callId !== null`). The cached token is still available to the unload
  beacon whenever a seat is held; the heartbeat sweep is the backstop if a call
  ends before the first fetch resolves.
- **Why**: every signed-in user hit `/api/auth/convex/token` on mount and once a
  minute forever, even with no call.
- **Measurement**: reasoned.

## 8. W13 — `8362029`

- **Files**: `apps/web/src/components/kanban/use-board.ts`.
- **What**: `useClock` starts its 1 s interval only while
  `document.visibilityState !== "hidden"`, stops it when hidden, and refreshes
  once on resume.
- **Why**: the board re-rendered once a second unconditionally (3600 renders/hour
  of an open background tab). Countdowns stay correct while visible.
- **Measurement**: reasoned; `kanban` tests pass.

## 9. P5 (web part) — `4a4f2ef`

- **Files**: `apps/web/src/providers/DesktopUpdateProvider.tsx`,
  `apps/web/src/providers/WorkspaceUpdateProvider.tsx`.
- **What**: the desktop 6 h update check is now a recursive `setTimeout` with
  ±30 min of jitter. The workspace release check runs on mount and every 6 h only
  while the host heartbeat is **not** fresh, and re-runs when the heartbeat goes
  stale. Manual "Check for updates" still routes through `checkNow`.
- **Why**: a fixed interval made a fleet of launches hit the update endpoint in
  lockstep, and the server-side release check duplicated what the host watcher
  already reports while its heartbeat is fresh.
- **Measurement**: reasoned; `workspace-updates` tests pass.

## 10. W6 — code splitting — `e24384a`

- **Files**: `apps/web/src/components/chat/ChatView.tsx`,
  `apps/web/src/routes/HomeRoute.tsx`, `apps/web/vite.config.ts`.
- **What**:
  - `React.lazy` + `Suspense` for `AdminPanel`, `KanbanView`, `NotesView`,
    `CallStage`, `CallDock`, `VoiceChannelView` (spinner fallback; `null` for the
    floating call surfaces) and for `ProfileSession` in `HomeRoute`.
  - Vendor chunking via rolldown `build.rolldownOptions.output.codeSplitting`
    groups: `react`/`react-dom`/`scheduler`, `convex`, `@tanstack/*`,
    `better-auth`/`@better-fetch`/`nanostores`/`@convex-dev`.
- **Before / after** (`bun run --cwd apps/web build`, Vite 8.3.1 / rolldown):

  | | Entry chunk | Gzip |
  | --- | ---: | ---: |
  | Baseline (audit) | 1,188,873 B | 343,910 B |
  | Before W6 (after items 1–9) | 1,191.67 kB (1,220,270 B) | 344.69 kB |
  | **After W6** | **76.78 kB (78,623 B)** | **25.15 kB** |

  New on-demand vendor / surface chunks: `react` 189.59 kB, `ProfileSession`
  254.54 kB, `AdminPanel` 175.26 kB, `KanbanView` 84.48 kB, `convex` 75.12 kB,
  `tanstack` 74.11 kB, `api` 69.93 kB, `NotesView` 63.55 kB, `auth` 30.90 kB,
  `VoiceChannelView` 5.81 kB, `CallStage` 3.45 kB, `CallDock` 2.02 kB. The entry
  chunk is now ~24× smaller raw and ~14× smaller gzipped.
- **Verify**: `bun run --cwd apps/web build` (chunks above), plus typecheck /
  lint / test all pass. `kanban` and `notes` tests import the components directly
  and are unaffected by the lazy wrappers.

---

## Skipped / not attempted

None. Every item in the list landed. Optional sub-changes that were intentionally
not taken to keep risk low:

- W2's optional move of `micLevel` out of the shared voice context into a
  dedicated store (the quantization + 10 Hz meter removes the churn without an
  API change).
- Lazy-loading `CallPictureInPicture`/`IncomingCallModal` (always mounted, so a
  `Suspense` boundary would suspend the shell on load). `RedeemScreen` also still
  statically imports `auth-client`, so the `auth` chunk is `modulepreload`ed on
  the connect screen; only `ProfileSession` was in scope for W16/W6.

## Final verification (HEAD = `e24384a`)

| Command | Result |
| --- | --- |
| `bun run --cwd apps/web typecheck` | pass |
| `bun run --cwd apps/web lint` | pass (`351 files`, no fixes) |
| `bun run --cwd apps/web test` | pass (66 files, 515 tests) |
| `bun run --cwd apps/web build` | pass; entry 76.78 kB / 25.15 kB gzip |
