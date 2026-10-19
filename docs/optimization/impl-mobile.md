# Mobile client optimization implementation

Branch: `t3/scale-resource-optimization`. One focused commit per item. No schema,
API-contract, data or UX-behaviour changes; scroll-to-unread, pagination and the
inverted `FlatList` behaviour are preserved.

Verification run after every commit (from the repo root):

```
bun run --cwd apps/mobile typecheck   # tsc --noEmit
bun run --cwd apps/mobile lint        # biome check .
bun run --cwd apps/mobile test        # vitest run
```

All three pass on the final commit: typecheck clean, lint `Checked 199 files …
No fixes applied`, tests `22 files / 142 tests passed`.

| # | Item | Status | Commit |
| --- | --- | --- | --- |
| 1 | M4 — idle outbox flush | landed | `31b5ad2` |
| 2 | M5 — typing throttle | landed | `2b61cf9` |
| 3 | M12 — avatar memoization | landed | `b1bfde5` |
| 4 | M1 — message list rows | landed | `ef3f7f8` |
| 5 | M8 — attachment map | landed | `650ad4f` |
| 6 | M7 — here-now presence index | landed | `73714f7` |
| 7 | M13 — background timers / callback | landed | `4d2a689` |
| 8 | M9 — voice level emits | landed | `0573d29` |

---

## 1. M4 — skip the idle outbox flush — `31b5ad2`

- **Files**: `apps/mobile/src/providers/ChatProvider.tsx`.
- **What**: `flush()` returns early when `await active.pendingCount() === 0`, so an
  empty (or fully failed) queue performs no store write and no state refresh.
  `refreshOutbox()` keeps the previous array reference when the items are
  unchanged (`sameOutbox` compares id/status/attempts/lastAttemptAt/nextAttemptAt).
  The 5 s ticker is gated on `AppState.currentState === "active"`, ticks only when
  an in-memory item is not `failed`, and its interval is cleared while the app is
  backgrounded and re-armed (with an immediate retry) on resume.
- **Why (performance impact)**: the ticker ran `flush()` unconditionally and
  `Outbox.list()` always returns a fresh sorted array, so `setOutbox` minted a new
  `ChatContextValue` 12×/min even with nothing queued, re-rendering every
  `useChat()` consumer (and an AsyncStorage read per tick, including in the
  background). Queued items still retry on the same cadence with the existing
  exponential backoff.
- **Measurement**: reasoned; the offline/outbox tests still pass.
- **Verify**: the three commands above; all pass.

## 2. M5 — throttle typing pings and clear them — `2b61cf9`

- **Files**: `apps/mobile/src/components/chat/Composer.tsx`,
  `apps/mobile/src/components/chat/ChatConversation.tsx`,
  `apps/mobile/src/components/chat/ThreadModal.tsx`.
- **What**: `Composer` wraps `onTyping` in `createTypingThrottle` from
  `@aulora/core` (one ping per 3 s per channel); the instance is created once and
  calls through a ref to the latest callback. `onClearTyping` is called on send,
  on input blur and on channel change (effect cleanup), and resets the throttle so
  the next keystroke re-announces. `ChatConversation` and `ThreadModal` pass
  `onClearTyping` through to `port.clearTyping`.
- **Why**: the composer fired a `setTyping` mutation on every keystroke and mobile
  never called `clearTyping`, so a 60-character message sent 60 mutations, each
  invalidating `typing.list` for every other member in the channel. The helper is
  shared from `packages/core`; nothing is imported from `apps/web`.
- **Measurement**: reasoned; no composer tests exist to regress.
- **Verify**: the three commands above; all pass.

## 3. M12 — memoize avatar SVG and components — `b1bfde5`

- **Files**: `packages/avatars/src/native.tsx`,
  `apps/mobile/src/components/chat/MemberAvatar.tsx`.
- **What**: `AvatarBody` memoizes the generated SVG string per `(seed, size)` (and
  skips the work when a profile picture is set). `NativeAvatar`, `NativeBlobatar`
  and the mobile `MemberAvatar` are wrapped in `React.memo`; their context
  (avatar urls, colour scheme) still drives updates. No thumbnail pipeline.
- **Why**: `avatarSvg(seed, { size })` ran inside render for every avatar row, so
  unrelated re-renders re-ran the blobatar geometry and re-parsed the SVG string
  into native views. Avatars appear in nearly every list row.
- **Measurement**: reasoned; mobile tests still pass.
- **Verify**: the three commands above; all pass.

## 4. M1 — index replies and stabilise rows — `ef3f7f8`

- **Files**: `apps/mobile/src/components/chat/MessageList.tsx`,
  `apps/mobile/src/components/chat/MessageRow.tsx`.
- **What**: an id → message `Map` is built in the same `useMemo` as the rows, so
  reply previews are O(1) instead of a `props.messages.find(...)` per reply row.
  The row context, row data slice, `renderItem` and `keyExtractor` are hoisted
  into `useMemo`/`useCallback`; the parent's unstable callbacks are read through a
  latest-props ref and `jumpTo`/sheet handlers are stabilised, so the context
  identity only changes with conversation data. `RowItem` and `MessageRow` are
  `React.memo`ized and rows take a boolean `highlighted`, so a row re-renders only
  when its own message, text, reply, attachments or highlight changes.
- **Why**: `replyPreview` scanned the full message array per reply row per render
  (O(rows × messages) — ~200k comparisons for a 1 000-message channel with 200
  replies), and the inline context/`renderItem` meant every mounted row
  re-rendered on any parent update (typing, presence, keystroke, flash).
- **Measurement**: reasoned; the message-row helpers remain covered by the
  existing suite. Scroll-to-unread, pagination and inversion unchanged.
- **Verify**: the three commands above; all pass.

## 5. M8 — memoize the attachment map — `650ad4f`

- **Files**: `apps/mobile/src/components/chat/use-chat-screen-data.ts`.
- **What**: `attachmentsByMessage` moved from an IIFE in the render body to
  `useMemo` keyed on its real inputs (`runtime`, `messageContext?.history`,
  `sessionState.messages`); output identical. The other derived collections
  (`mergedMessages`, `mergedDecrypted`, `memberNames`, `memberColors`,
  `pendingIds`) were already memoized and were left as-is.
- **Why**: a fresh `Map` identity on every parent render flowed into the message
  list and defeated the memoized rows, and repeated the descriptor walk.
- **Measurement**: reasoned; all tests pass.
- **Verify**: the three commands above; all pass.

## 6. M7 (low-risk part) — index presence for here-now — `73714f7`

- **Files**: `apps/mobile/src/components/chat/ChannelList.tsx`.
- **What**: `HereNow` builds a `userId → status` `Map` once with `useMemo` and
  looks up by id for the filter, the sort and each rendered face, replacing a
  linear `presence.find` inside the sort comparator. The strip is capped at
  `HERE_NOW_LIMIT` (24) faces; the accessibility label still reports everyone who
  is around. Lists remain `ScrollView`s.
- **Why**: the previous filter + comparator were O(members × presence) on every
  hub render, and the strip mounted a row for every online member.
- **Measurement**: reasoned; all tests pass.
- **Verify**: the three commands above; all pass.

## 7. M13 — background timers and a stable callback — `4d2a689`

- **Files**: `apps/mobile/src/components/QueryErrorBoundary.tsx`,
  `apps/mobile/src/components/chat/use-chat-screen-data.ts`.
- **What**: the `QueryErrorBoundary` 4 s retry interval now starts only while
  `AppState` is active, is cleared on background and resumed (with a retry) on
  foreground; the connection-state and foreground retries are unchanged. The
  inline `callerName` arrow passed to `useIncomingCallNotification` is wrapped in
  `useCallback` keyed on `memberNames`.
- **Why**: the interval bumped state forever, including backgrounded, waking the
  device for a no-op; the per-render arrow made the notification effect re-run on
  every chat render.
- **Measurement**: reasoned; all tests pass.
- **Verify**: the three commands above; all pass.

## 8. M9 — quantize level emits and reuse the snapshot — `0573d29`

- **Files**: `apps/mobile/src/lib/voice/call-engine-core.ts`,
  `apps/mobile/src/lib/voice/call-engine-media.ts`.
- **What**: the mic level meter rounds to whole percent and only emits when that
  value changed (the noise gate still reads the raw level); remote levels are
  quantized to 2 decimals before the existing 0.02 delta test. `getSnapshot()`
  caches the last snapshot and returns it when every field — including copied
  level and stream maps — is unchanged, so a no-op emit is free. Levels are not
  moved to a separate context.
- **Why**: the meter emitted ~every 400 ms and the remote hunt could emit every
  500 ms, and `getSnapshot()` always returned a brand-new object, so
  `setSnapshot` re-rendered the whole chat subtree 2–5×/s during a call for
  level-only changes.
- **Measurement**: reasoned. The snapshot copy shares the stream objects, so
  `pc.ontrack` updates remain visible; provider behaviour is unchanged.
- **Verify**: the three commands above; all pass.

---

## Skipped / not attempted

None. Every item in the assigned list landed. Sub-changes intentionally not taken
to keep risk low:

- M5: nothing beyond the throttle + `clearTyping` — no server typing semantics
  change.
- M7: the wider "convert the lists to FlatList" work was out of scope for this
  pass.
- M9: levels were not moved to a separate context/store; the higher-risk
  restructuring (and M3's presence splitting) remains for a later pass.
- M8: the already-memoized collections were left untouched as instructed.

## Final verification (HEAD = `0573d29`)

| Command | Result |
| --- | --- |
| `bun run --cwd apps/mobile typecheck` | pass |
| `bun run --cwd apps/mobile lint` | pass (`199 files`, no fixes) |
| `bun run --cwd apps/mobile test` | pass (22 files, 142 tests) |
