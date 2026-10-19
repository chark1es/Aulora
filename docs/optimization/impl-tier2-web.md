# Tier-2 web client migration — implementation report

Branch: `t3/scale-resource-optimization`
Scope: the **web** client (`apps/web`) and its use of the Tier-2 additive
backend APIs (`packages/convex`). The backend queries landed first (see
`impl-tier2-apis.md`); this report covers the coordinated client wave.

Only `apps/web` changed. `packages/core` and `apps/mobile` were **not** touched,
so their required checks are unaffected; they were still run for completeness at
the end (all green).

## Status

| # | Finding | Status | Commit |
| --- | --- | --- | --- |
| 1 | W8 / B3 — scoped presence instead of the whole table | **landed** | `a67996a` |
| 2 | B2 — member panel + mention picker paged/search queries | **deferred** (rationale below) | — |
| 3 | W1 — open only the active and recent channels | **landed** | `3be780f` |

Verification was run from the repo root after **each** commit:

- `bun run --cwd apps/web typecheck` → clean
- `bun run --cwd apps/web lint` → `Checked 357 files … No fixes applied`
- `bun run --cwd apps/web test` → `69 passed (69)`, `529 passed (529)`

## 1. W8/B3 — scoped presence (`a67996a`)

- **Files:** `apps/web/src/lib/presence-scope.ts` (new),
  `apps/web/src/lib/convex-chat.ts`, `apps/web/src/lib/chat-runtime.ts`,
  `apps/web/src/components/chat/ChatView.tsx`,
  `apps/web/src/components/chat/ChannelSidebar.tsx`,
  `apps/web/src/components/WorkspaceMenu.tsx`,
  `apps/web/src/test/presence-scope.test.ts` (new).
- **What:** `presence.list` (whole table, re-sent on every heartbeat) is no
  longer requested. The web adapter resolves the presence subscription through a
  new `createScopedPresence` controller backed by `presence.getMany({ userIds })`.
  Every listener (the session's aggregate watch and the provider's subscription)
  shares **one** underlying query; the query is torn down and re-created only when
  the scope changes, and cleared immediately so a stale status cannot linger.
- **Scope / cap:** `buildPresenceScope` unions, in render-priority order, the
  viewer, the open timeline's authors, the displayed member panel/modal members,
  the sidebar's DM partners and any open picker, then de-duplicates and caps at
  `PRESENCE_SCOPE_MAX = 300` — matching the server's own `getMany` cap. `ChatView`
  reports the scope to the runtime on every change. The controller caps again
  defensively.
- **Renders:** the per-row `setCustomStatuses` loop was replaced with a single
  `setState` that builds the map once per presence update.
- **Behaviour implications:**
  - The member panel's status for every displayed member is correct up to the
    300-id cap; for a workspace with more relevant users than the cap the tail
    reads as offline. (Item 2 would make the panel page, keeping it under the
    cap; see below.)
  - The workspace "N online" header count is now derived from the scoped set. It
    is exact for a workspace whose on-screen set is under the cap and a lower
    bound above it; its `title` now labels it as scoped
    ("Online among the people currently shown"). This is the explicitly allowed
    trade-off from the task.
  - `packages/core`'s `ChatSession` is unchanged; the aggregate watch in
    `ChatSession.start()` now simply receives the scoped rows (nothing consumes
    `session.presence()`).

## 2. B2 — member panel + mention picker paged/search — **deferred**

- **Why deferred (correctness, not effort):** the member directory is not only
  the panel's data source. `ChatSessionShell` loads `api.members.list` once and
  the same rows feed, besides the member panel:
  - display names for every timeline author / DM title (`memberNames`,
    `titles`) — off-page authors would render "Unknown member";
  - `@everyone` / `@here` and `@role` broadcast expansion
    (`expandBroadcast` needs every member id; `mentionRoles.memberUserIds` needs
    every member's roles), which is computed **client-side** and sent as
    `mentionUserIds`. A paged directory would silently under-notify.
  Every backend change needed to keep those correct without the full collect
  (e.g. a lightweight id+name directory query, or server-side broadcast
  resolution) would require editing `packages/convex`, which is out of scope for
  this wave. Paging the panel/pickers while keeping `members.list` would add a
  second read rather than remove one, and paging it alone would regress the two
  behaviours above — so it was not landed.
- **Recommended follow-up:** add a bounded directory query that returns
  `{ userId, displayName, roleIds }` for broadcast/name resolution (or resolve
  `@everyone`/`@role` on the server), then migrate the panel to
  `members.page` (with "load more") and the pickers to `members.search`
  (debounced). `api.members.page` / `api.members.search` already exist.
- **Admin note:** `MemberManager` still uses `members.list`; it is admin-gated
  and would move to `members.page` in the same follow-up.

## 3. W1 — bounded eager channel open (`3be780f`)

- **Files:** `apps/web/src/lib/channel-priority.ts` (new),
  `apps/web/src/lib/use-unopened-channel-alerts.ts` (new),
  `apps/web/src/providers/ChatProvider.tsx`,
  `apps/web/src/components/chat/ChatSessionShell.tsx`,
  `apps/web/src/components/chat/ChatView.tsx`,
  `apps/web/src/test/channel-priority.test.ts` (new),
  `apps/web/src/test/unopened-channel-alerts.test.ts` (new).
- **What:** `ChatProvider` no longer maps `openChannel` over every channel.
  `selectEagerChannelIds` picks the conversations the sidebar highlights as
  unread/mentioning (most recent activity first) plus a small fill, and only
  those streams are opened. Channels that leave the eager set are closed again,
  so a long session cannot accumulate one live stream per conversation ever
  highlighted. Plaintext channel **names** are still cached for every channel
  (local, no subscription).
- **Cap:** `EAGER_CHANNEL_OPEN_CAP = 8`. The open conversation is streamed by
  `useChannelSession` (one subscription, no double open) and is intentionally not
  part of this set.
- **Alerts / badges kept working:**
  - Unread badges already read `readStates.summary` (unchanged).
  - Chimes and OS notifications for channels **outside** the eager set are driven
    by a diff of the already-subscribed `readStates.summary`
    (`useUnopenedChannelAlerts`): a rise in `mentionCount` plays the mention
    chime / raises a "Mentioned in #…" notification, a rise in activity on an
    unread channel plays the message chime / raises "#…"; eagerly-open, active
    and muted channels are skipped, and the first snapshot seeds so sign-in does
    not replay history. Bodies stay on the server, so these notifications are
    generic (the existing per-message body notification path is unchanged for the
    eager/active channels).
  - The local search backfill already pages history on demand and is the source
    for unopened channels.
- **Behaviour implication:** the notification body for a non-eager background
  channel is generic rather than the message text. This matches the server's
  content-free Web Push wake and is the trade-off the task called out.

## Recommended follow-ups (not in this wave)

1. Complete B2 as described above once a bounded id/name directory (or
   server-side broadcast resolution) exists.
2. Run the same two migrations on `apps/mobile` (`providers/ChatProvider.tsx`
   still subscribes `members.list` and `presence.list`).

## Final verification

- `bun run --cwd apps/web typecheck` → clean
- `bun run --cwd apps/web lint` → `Checked 357 files … No fixes applied`
- `bun run --cwd apps/web test` → `69 passed (69)`, `529 passed (529)`
- `bun run --cwd packages/core typecheck` → clean (unchanged)
- `bun run --cwd packages/core lint` → `Checked 69 files … No fixes applied`
- `bun run --cwd packages/core test` → `24 passed (24)`, `332 passed (332)`
- `apps/mobile` untouched; no `packages/core` export/method changed, so its
  typecheck was not required.
