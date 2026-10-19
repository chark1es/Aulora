# Tier-2 mobile client migration — implementation report

Branch: `t3/scale-resource-optimization`
Scope: the **mobile** client (`apps/mobile`) and the one shared `packages/core`
change it required (`ChatSession`). The web client was migrated in the previous
wave (`impl-tier2-web.md`); the backend APIs landed in `impl-tier2-apis.md`.

Each item is one focused commit, with the mobile checks
(`apps/mobile typecheck` / `lint` / `test`) run after every commit. Because item 1
touches `packages/core`, the shared-package checks
(`packages/core typecheck` / `lint` / `test`) and the dependent web checks
(`apps/web typecheck` / `test`) were run for that commit too, and again at HEAD.

## Status

| # | Finding | Status | Commit |
| --- | --- | --- | --- |
| 1 | M3 — scoped presence, not the whole table | **landed** (members part deferred, rationale below) | `9481b16` |
| 2 | M2 — one batched reactions subscription per timeline | **landed** | `330649a` |
| 3 | M14 — scope local notifications to the open conversation | **landed** | `6fc1073` |
| 4 | M10 — incremental indexing + bounded backfill | **landed** | `6cd69c0` |
| 5 | M11 — one live subscription for history | **landed** | `6132823` |

## 1. M3 — scoped presence (`9481b16`)

- **Files:** `apps/mobile/src/lib/presence-scope.ts` (new),
  `apps/mobile/src/lib/convex-chat.ts`, `apps/mobile/src/lib/chat-runtime.ts`,
  `apps/mobile/src/providers/ChatProvider.tsx`,
  `apps/mobile/src/components/chat/use-chat-screen-data.ts`,
  `apps/mobile/test/presence-scope.test.ts` (new),
  `packages/core/src/chat/session.ts`.
- **What:** `presence.list` (whole table, re-sent on every heartbeat) is no longer
  requested by the app. The adapter resolves presence through a new
  `createScopedPresence` controller backed by `presence.getMany({ userIds })`;
  the session's aggregate watch and the provider's subscription share **one**
  underlying query, torn down and re-created only when the scope changes. The
  screen reports the scope to the runtime on every change.
- **Scope / cap:** `buildPresenceScope` unions, in render-priority order, the
  viewer, the open timeline's authors, the members pane's members (counted only
  while the pane is on screen) and the channel list's DM partners, then
  de-duplicates and caps at `PRESENCE_SCOPE_MAX = 300` — matching the server's
  `getMany` cap. The controller caps again defensively.
- **Core change + web impact:** `ChatSession.start()` no longer subscribes
  presence, and the unused `presence()` / `latestPresence` were removed. Web was
  already migrated and reads presence from the scoped controller
  (`ChatView` → `runtime.setPresenceScope`), so nothing consumed
  `session.presence()`; web is unaffected. `watchPresence` remains on the
  `ChatSubscriptions` contract and is still used by both providers.
- **Deferred — members (`members.list` → `members.page`/`members.search`):**
  the member directory is not only the pane's data source. The same rows feed
  display names for every timeline author / DM title and the **client-side**
  `@everyone`/`@here` and `@role` broadcast expansion (`expandBroadcast` needs
  every member id; `roles[].memberUserIds` needs every member's roles), which is
  computed on-device and sent as `mentionUserIds`. Paging the pane/picker while
  keeping `members.list` would add a second read rather than remove one, and
  paging it alone would regress those two behaviours (off-page authors would
  render unnamed; broadcasts would silently under-notify). Doing it correctly
  needs a bounded id+name directory query or server-side broadcast resolution,
  both of which require editing `packages/convex` (out of scope). This is the
  exact call the web migration made (`impl-tier2-web.md`, item 2); the same
  follow-up applies to mobile.

## 2. M2 — batched reactions (`330649a`)

- **Files:** `apps/mobile/src/lib/convex-chat.ts`,
  `apps/mobile/src/lib/message-rows.ts`,
  `apps/mobile/src/components/chat/MessageList.tsx`,
  `apps/mobile/src/components/chat/MessageRow.tsx`,
  `apps/mobile/src/components/chat/ReactionRow.tsx`,
  `apps/mobile/test/message-rows.test.ts`.
- **What:** `MessageList` mounts **one** `watchReactionsBatch` subscription for
  the timeline's message ids and passes each message its grouped reactions down
  to `ReactionRow`, which no longer opens a query per row. A message with no
  reactions renders nothing and holds no subscription. Adapters without batch
  support (the offline demo) keep the previous per-row subscription as a
  fallback, matching the contract's "adapters that do not implement it fall back
  to `watchReactions` per message".
- **Cap:** chunked at the server's `listForMessages` cap of **100** message ids
  per underlying query (`REACTION_BATCH_SIZE = 100`); one subscription per chunk.
- **Core / web:** none.

## 3. M14 — scoped local notifications (`6fc1073`)

- **Files:** `apps/mobile/src/lib/notifications.ts`,
  `apps/mobile/src/components/chat/use-chat-screen-data.ts`.
- **What:** `useLocalNotifications` takes the active channel id: while the app is
  foregrounded (`AppState === "active"`), a new message in the conversation on
  screen is marked seen but raises no banner, no cue and no badge. Every other
  channel still notifies, and the incoming-call path is untouched. Opening a
  conversation resets the badge, and each notification now carries its
  `channelId` in `data` so the OS can group per conversation.
- **Cap:** n/a.
- **Core / web:** none.

## 4. M10 — incremental indexing + bounded backfill (`6cd69c0`)

- **Files:** `apps/mobile/src/providers/ChatProvider.tsx`,
  `apps/mobile/src/lib/use-search.ts`, `apps/mobile/src/lib/convex-chat.ts`.
- **What:** `onDecrypted` re-emits the whole loaded list on every change; the
  provider now keeps the text already indexed per message id and indexes only
  new or edited messages, removing deleted ones, instead of walking the entire
  list each time. The archive backfill (`useMessageSearch`) is bounded and
  re-runs the device-local index query every few pages rather than after every
  page; it still stops on query change.
- **Cap:** archive reads are **200**-message pages (`ARCHIVE_PAGE_NUM`) and a
  search pulls at most **12** pages (`ARCHIVE_STEP_CAP`), refetching the index
  every **3** pages (`SEARCH_REFRESH_EVERY`). Results are complete for everything
  indexed within the cap. Index persistence stays out of scope (item's explicit
  option), so the index is still per-session on mobile.
- **Core / web:** none (core `ArchiveBackfill` untouched; the mobile port's page
  size changed, not the shared code).

## 5. M11 — one live subscription for history (`6132823`)

- **Files:** `apps/mobile/src/lib/use-channel.ts`.
- **What:** `useChannelSession` keeps exactly **one** live subscription on the
  newest page and fetches each older page once as a snapshot via the port (not a
  subscription), prepending it and merging in page order — no full re-sort and no
  accumulating live queries. Pagination, `hasOlder`, jump-to-message and
  scroll-to-unread are preserved; a tail update rebuilds the same window without
  re-fetching older pages, and a pending snapshot is dropped on channel change.
- **Cap:** older pages are read on demand (one in flight at a time); no fixed
  page-count cap, matching the previous scroll-to-load behaviour.
- **Core / web:** none.

## Final verification (HEAD)

Run from the repo root:

- `bun run --cwd apps/mobile typecheck` → clean
- `bun run --cwd apps/mobile lint` → `Checked 201 files … No fixes applied`
- `bun run --cwd apps/mobile test` → `23 passed (23)`, `149 passed (149)`
- `bun run --cwd packages/core typecheck` → clean
- `bun run --cwd packages/core lint` → `Checked 69 files … No fixes applied`
- `bun run --cwd packages/core test` → `24 passed (24)`, `332 passed (332)`
- `bun run --cwd apps/web typecheck` → clean
- `bun run --cwd apps/web test` → `69 passed (69)`, `529 passed (529)`

Every item landed; item 1's member-directory half is deferred with the same
rationale the web migration recorded, pending a bounded id+name directory query
(or server-side `@everyone`/`@role` resolution) that would need a
`packages/convex` change.
