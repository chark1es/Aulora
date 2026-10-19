# Backend findings

Audit of the Aulora Convex backend (`packages/convex/convex/`, ~19.4k lines in-tree)
for scaling from current sizes to 100,000+ users in a single workspace
(one deployment = one workspace, so every table is workspace-wide, not sharded).

## Summary (5 bullets max, biggest wins)

- **The unread/sidebar/badge read path is O(total messages) per client.** `notifications.unreadSummary` (subscribed app-wide on desktop) and `readStates.set`/`summary` collect an entire channel's message history on every call. Fixing unread to a bounded tail read or a precomputed counter is the single biggest win.
- **Several app-wide reactive queries full-collect whole tables.** `members.list`, `presence.list`, `messages.threadInbox`, and `calls.incoming`/`activeCalls` are subscribed by every connected client and each `.collect()`s a global table (members, presence, messages, calls). At 100k users these re-run on every write to those tables.
- **Notification fan-out is quadratic-ish per message.** `resolveMessageRecipients` full-collects the `presence` table and issues one `notificationPrefs` collect per candidate, and it runs twice per message (web + mobile dispatch).
- **30s sweeps scan whole tables.** `presence.sweepStale` (`presence.collect()`), `typing.purgeExpired` (`typing.collect()`), and `calls.sweep` (three `.collect()`s) each run every 30s; presence must also be written by ~3.3k heartbeats/sec at 100k.
- **Permission checks re-load the same context and re-derive crypto keys on every row/call.** `loadPermissionContext` (`roles.collect()` + `server.first()`) runs on every channel access and again per file in `files.getMany`; and `lib/sse.ts` re-runs HKDF `importKey`+`deriveKey` for every sealed value instead of caching the data key per scope.

## Findings

### B1. `notifications.unreadSummary` reads every message in every joined channel
- Evidence: `packages/convex/convex/notifications.ts:179-227` (loop 184-187, `messages ... .collect()` 202-205), client `apps/web/src/lib/use-desktop-unread.ts:19`, `apps/mobile/src/lib/convex-chat.ts` unread usage.
- Problem: for each of the caller's channel memberships it does `messages.withIndex("by_channel_created").collect()` — the **entire** channel history — then does a linear `findIndex` for the read cursor and walks the tail in JS. No `take`, no bound.
- Impact at 100k: **high** — it is a reactive query subscribed by every desktop client, so it re-runs on every message in any channel the viewer belongs to. A user in 200 channels averaging 50k messages forces ~10M row reads per recompute, and the total across connected clients is astronomical. This alone will exhaust the deployment's function-read budget and CPU.
- Effort: medium.
- Risk: medium — recomputing unread from a cursor must preserve the current "unread = other authors' non-deleted root messages" semantics.
- Proposed fix: never `collect()` history. Use `by_channel_created` with `.gt` on the cursor `_creationTime` and `.take(N)` (badge saturates anyway), or maintain a per-channel monotonic counter + last-read timestamp on `readStates`/`channels` and compute the difference with two bounded reads. Consider a `readStates` doc holding `lastReadAt` so the unread scan can start from an index range.

### B2. `members.list` full-collects members and makes one auth call + one `getUrl` per member; subscribed by every client
- Evidence: `packages/convex/convex/members.ts:263-279` (`ctx.db.query("members").collect()` at 268), `toMemberView` `members.ts:241-260` (`ctx.storage.getUrl` per member), `accountNames` `lib/accountNames.ts:48-65` (one `authComponent.getAnyUserById` per user); subscribed at `apps/web/src/components/chat/ChatSessionShell.tsx:63`, `apps/mobile/src/providers/ChatProvider.tsx:358`.
- Problem: an unbounded collect of the entire workspace member table, followed by an N-call auth-component lookup and an N `storage.getUrl` call, inside a query every client subscribes to.
- Impact at 100k: **high** — at 100k members this is 100k doc reads + ~100k cross-component auth lookups + 100k storage URL resolutions per recompute, on every member/role change. It will exceed per-execution read/CPU limits and is a hard blocker before 100k.
- Effort: medium.
- Risk: medium — the member directory is used broadly for mention autocomplete and the member manager; needs pagination or a server-side search.
- Proposed fix: paginate `members.list` (index on `joinedAt`), or split into an admin-only full list and a lightweight directory query with `search` over nickname + resolved account names, and drop `avatarUrl` per row in favor of a lazy per-avatar `get`. Cache account names rather than resolving per row.

### B3. `presence.list` full-collects and decrypts the whole presence table; subscribed by every client
- Evidence: `packages/convex/convex/presence.ts:152-167` (`presence.collect()` 157, `openContentOptional` per row 162), subscribed at `apps/web/src/lib/convex-chat.ts:418`, `apps/mobile/src/lib/convex-chat.ts:443`.
- Problem: every presence row is read and its `customStatusCiphertext` opened individually, then the whole array is returned.
- Impact at 100k: **high** — one client re-reads up to 100k presence rows and performs up to 100k HKDF derive+AES decrypts (see B19) on every presence write. With ~3.3k heartbeats/sec at 100k, this query re-runs continuously; multiplies CPU badly.
- Effort: low-medium.
- Risk: low — UI only needs status for visible members.
- Proposed fix: replace with a targeted query (`presence.getMany({ userIds })` over the visible roster) and drive it from the member list, or page presence. Do not send the whole table to every client.

### B4. Presence heartbeat is a mutation per user every 30s with redundant reads and a license write path
- Evidence: `packages/convex/convex/presence.ts:87-113`; `recordLicenseActivity` `lib/licenseActivity.ts:9-55` (calls `server.first()`, `members.by_user`, `licenseActivity` lookup, possible insert/aggregate patch); `requireMember` `lib/permissions.ts:92-102`.
- Problem: each heartbeat does `requireAuth` → `requireMember` (member row) → `recordLicenseActivity` (`server.first()` + member row + license-activity lookup, and on the first call of the month an insert + aggregate patch) → presence lookup → patch. ~5-7 reads + 1 write per heartbeat.
- Impact at 100k: **high** — 100k / 30s ≈ 3,333 heartbeats/sec → ~20k reads/sec + ~3.3k presence writes/sec, purely for presence, before any messaging. `recordLicenseActivity` adds 3 more reads to every heartbeat even when the month is already recorded (the write is idempotent-guarded, so it's mostly wasted reads).
- Effort: medium.
- Risk: medium — license seat counting must stay per-user-per-month correct.
- Proposed fix: short-circuit `recordLicenseActivity` faster (early-return on an unlicensed/inactive server without the extra lookups; ideally memoize per function invocation). Batch or lengthen the presence heartbeat cadence (e.g. 45-60s server-side tolerance), and avoid `requireMember` + `recordLicenseActivity` both re-reading the member row.

### B5. `presence.sweepStale` cron full-collects presence every 30s
- Evidence: `packages/convex/convex/presence.ts:196-218` (`presence.collect()` 200), cron `crons.ts:11`.
- Problem: reads all presence rows, then patches each stale one, every 30 seconds.
- Impact at 100k: **high** — 100k rows × 2 runs/min = 200k reads/min (3.3k reads/s) minimum, plus writes for stale transitions. At 100k it will not finish within a 30s budget.
- Effort: medium.
- Risk: low — a stale threshold sweep can be batched without semantic change.
- Proposed fix: add an index on `lastHeartbeat` (or `status`+`lastHeartbeat`) and scan only rows past the idle/offline threshold with `.take(batch)`, rescheduling; never collect the whole table. Consider deriving idle/offline from `lastHeartbeat` at read time instead of sweeping.

### B6. `typing` operations collect all rows for a channel; purge scans the whole table
- Evidence: `packages/convex/convex/typing.ts:11-33` (set: `typing.withIndex("by_channel").collect()` 17-20), `36-50` (clear: collect 40-43), `69-82` (purge: `typing.collect()` 73), cron `crons.ts:12`.
- Problem: `typing.set`/`clear` fetch every typing row in the channel to find the caller's row (no `(channelId,userId)` index), and the 30s purge reads the whole `typing` table.
- Impact at 100k: **medium-high** — `typing.set` fires on keystrokes while typing, so in a 10k-member channel each event reads up to the number of concurrent typers; the purge is a full-table scan 2×/min.
- Effort: low.
- Risk: low.
- Proposed fix: add index `by_channel_user` on `(channelId, userId)` and use `.unique()` in set/clear; batch the purge with an `expiresAt` index (`by_expires`) + `.take`, rescheduling.

### B7. `readStates.set` collects the entire channel history to count mentions
- Evidence: `packages/convex/convex/readStates.ts:12-31` (`messages.withIndex("by_channel_created").collect()` 18-21), called from `set` `readStates.ts:47-52`.
- Problem: every mark-read reads all messages in the channel (all history, all threads), does `findIndex`, then filters the tail for mentions — O(channel length) per read event.
- Impact at 100k: **high** — a busy channel with hundreds of thousands of messages makes every channel-open/mark-read read the whole thing; combined with B1 this is the dominant read cost.
- Effort: medium.
- Risk: medium — mention back-count must remain correct after edits/deletes.
- Proposed fix: bound the scan with `.gt(cursorTime).take(MENTION_SCAN_LIMIT)` using the cursor message's `_creationTime`, or maintain the mention count incrementally when messages are inserted/deleted (already stored on `readStates.mentionCount`; treat it as authoritative and update in `messages.send`/`remove` for members' mention lists).

### B8. `readStates.summary` misuses `by_channel_created` + `.filter(threadRootId)` instead of the existing `by_channel_thread` index
- Evidence: `packages/convex/convex/readStates.ts:129-174` (`by_channel_created` + `.filter(q => q.eq(q.field("threadRootId"), undefined))` 134-139 and 148-156); `summary` loop `184-198` (up to 200 channels, `requireChannelAccess` per channel).
- Problem: the schema already defines `by_channel_thread` `(channelId, threadRootId)` whose equality on `threadRootId === undefined` selects roots directly, but `summarizeChannel` scans `by_channel_created` and filters reply rows out post-index. In a channel with many replies, `.take(200)`/`.first()` reads far more rows than needed to produce 200 roots. It also runs once per channel id (N+1) with a full permission load each.
- Impact at 100k: **medium-high** — for the sidebar's 200 channels this is 400+ index scans (two per channel) plus 200 permission loads, each scan possibly reading many extra reply rows.
- Effort: low.
- Risk: low.
- Proposed fix: switch both queries to `by_channel_thread` with `.eq("threadRootId", undefined)` (as `messages.list` already does), and hoist the permission context once per user instead of per channel.

### B9. `messages.threadInbox` scans the newest 1000 messages across ALL channels with no index; subscribed everywhere
- Evidence: `packages/convex/convex/lib/threadInbox.ts:165` (`ctx.db.query("messages").order("desc").take(1000)`), entry `messages.ts:502-509`; subscribed at `apps/web/src/components/chat/ChatView.tsx:279`, `apps/mobile/src/components/chat/use-chat-screen-data.ts:50`.
- Problem: a global reverse scan of the `messages` table (no channel/user index), then `db.get` for each distinct root, then permission resolution per distinct channel. It returns only threads the viewer participated in, but must scan a global window to find them, and the window is tiny relative to global traffic.
- Impact at 100k: **high** — every client re-scans the last 1000 global messages on every message anywhere; at 100k users the newest 1000 messages may span seconds, so the inbox is stale *and* expensive. It also scales CPU with global message rate, not the viewer's activity.
- Effort: high.
- Risk: medium — needs a new per-user participation index.
- Proposed fix: maintain a per-user thread-participation set (e.g. `threadParticipants` on the root already exists as `replyParticipantIds`; add an index or a `userThreads` table written on mention/reply) and query that instead of scanning `messages`.

### B10. Notification recipient resolution full-collects `presence` and issues one prefs collect per member; runs twice per message
- Evidence: `packages/convex/convex/lib/messageRecipients.ts:126-164` (`presence.collect()` 132), `resolvePref` `19-35` (`notificationPrefs ... by_user_scope).collect()` per candidate 24-27), `collectCandidates` `86-124` (channelMembers collect 92-95); invoked by `notifications.dispatchForMessage` `407-432` and again by `dispatchMobileForMessage` `504-544` (both call `resolveRecipients`), scheduled from `messages.ts:252-255`.
- Problem: for each message, collect all channel members, then for every candidate collect that user's prefs, and full-collect the presence table — all inside one query. Then the whole resolution runs a second time for the mobile dispatch path. A message in a 5k-member channel does ~5k prefs queries + a full presence scan, twice.
- Impact at 100k: **high** — multiplies message-send cost by channel size and global presence size, and doubles it via the two scheduled jobs.
- Effort: medium-high.
- Risk: medium — recipient/preference semantics must be preserved.
- Proposed fix: pass the resolved recipient list from the single `resolveMessageRecipients` call into both dispatch actions (resolve once); replace per-candidate `notificationPrefs.collect()` with a single `by_channel` collect (or a `(channelId,userId)` index) and an in-memory map; replace the full `presence.collect()` with an indexed lookup of only the candidate ids (add `by_user`; it exists — query only candidates), or maintain an "active users" set.

### B11. `calls.sweep` cron full-collects `callParticipants`, `callSignals`, and `calls` every 30s
- Evidence: `packages/convex/convex/calls.ts:479-521` (`callParticipants.collect()` 483, `callSignals.collect()` 494, `calls.collect()` 500), cron `crons.ts:15`.
- Problem: three unbounded table scans every 30s; `callSignals` has no time index, so stale-signal cleanup must read every signalling row (ICE candidates are high-volume during calls).
- Impact at 100k: **medium-high** — `callSignals` can hold many rows per active call (each ICE candidate is a row); full scans every 30s on 3 tables add steady read load and grow with total call volume.
- Effort: medium.
- Risk: low.
- Proposed fix: add a `createdAt` index to `callSignals` and sweep with `.withIndex("by_created").lt(cutoff).take(batch)`; use `by_running_timer`/`by_user` for participants; use the existing `by_status` index for calls instead of a full collect.

### B12. `calls.incoming` and `calls.activeCalls` scan/filter the whole `calls` table; subscribed per client
- Evidence: `packages/convex/convex/calls.ts:394-406` (`by_status` collect + JS filter) and `412-449` (`.filter(q => q.neq(q.field("status"), "ended"))` full-table filter, then per-call `db.get` channel + permission resolution); subscribed at `apps/web/src/lib/voice/convex-voice.ts:138-141`, mobile equivalent.
- Problem: `activeCalls` applies a `.filter()` over the entire `calls` table (post-index filter, so it reads all `calls` rows including ended ones within retention) and then resolves permissions per call.
- Impact at 100k: **medium-high** — every connected client subscribes to `incoming`+`activeCalls`; each re-runs on every call change and reads the whole calls table + per-call channel/permission loads.
- Effort: low-medium.
- Risk: low.
- Proposed fix: use `by_status` for both active and ringing and union in code; do not use a `.filter()` on `status`; cache the permission context once per call to `activeCalls`.

### B13. `channels.visibleMemberIds` resolves every member's permissions for one channel; subscribed per open channel
- Evidence: `packages/convex/convex/lib/channelHelpers.ts:265-304` (`members.collect()` 271, `roles.collect()` 272, per-member `resolvePermissions` 283-301), query `channels.ts:207-216`; subscribed at `apps/web/src/components/chat/ChatView.tsx:650-661`.
- Problem: for a public channel it loads all members + all roles and resolves the effective bitfield for every member to decide visibility.
- Impact at 100k: **medium-high** — O(members) per open channel, re-run whenever a member/role/override changes, and subscribed by every client viewing a channel.
- Effort: medium.
- Risk: medium — used to decide mention candidates and reply audience.
- Proposed fix: precompute channel visibility on override/role changes, or answer from `channelMembers` for private/DM channels and cap/summarize for public ones; avoid resolving the full member table live.

### B14. Role/membership mutations collect all members and patch in a loop
- Evidence: `packages/convex/convex/roles.ts:187-194` (`members.collect()` then patch per matching member), `lib/channelHelpers.ts:176-182` (`resolvePrivateTargets` members.collect), `members.ts:156-164` (`detachFromChannels` by_user collect — bounded), `channels.ts` create/private paths.
- Problem: `roles.remove` reads all members and patches each one that holds the role in a single mutation.
- Impact at 100k: **medium** — a role held by thousands of members means thousands of reads+writes in one transaction, risking transaction size limits; also happens on channel creation with role grants.
- Effort: medium.
- Risk: medium — must keep role detachment consistent.
- Proposed fix: add an index on member `roleIds` (or a reverse `memberRoles` table) so the mutation touches only affected members and can be batched/rescheduled if large.

### B15. `channels.list` filters the channels table in-query instead of by index
- Evidence: `packages/convex/convex/channels.ts:132-136` (`.filter(q => q.and(neq kind "dm", neq kind "group_dm"))` over `channels`, then per-row `findChannelMember`/`categoryOverridesFor`/`listChannelMemberIds`), subscribed at `ChatSessionShell.tsx:60`, mobile `convex-chat.ts:411`.
- Problem: the kind filter is applied after the index scan, so pagination reads and discards every DM/group-DM row; the loop then does extra reads per channel.
- Impact at 100k: **medium** — workspaces with many DMs make channel pagination scan large fractions of the table even though only a page of channels is wanted.
- Effort: low.
- Risk: low.
- Proposed fix: add a `kind` index (or `(archived, kind)`) and query equality on the non-DM kinds; drop the post-filter.

### B16. Admin/introspection queries full-collect large tables
- Evidence: `packages/convex/convex/instance.ts:122-126` (`files`, `members`, `channels`, `devices` all `.collect()`), `auditLog.ts:33` (`members.collect()` plus `accountNames` over the page), `roleEditor`/`MemberManager` subscribe these.
- Problem: `instance.overview` sums `files.sizeBytes` by collecting every file row, and counts members/channels/devices by collecting each table. `auditLog.list` collects all members to resolve nicknames.
- Impact at 100k: **medium** — these are admin-only but will fail or time out with 100k members/files; `instance.overview` is subscribed while the admin panel is open.
- Effort: medium.
- Risk: low.
- Proposed fix: maintain running counters (or use an aggregate component) for storage bytes and counts; paginate/limit these queries.

### B17. License seat checks read up to 100k member rows per refresh
- Evidence: `packages/convex/convex/license.ts:59-70` (`members ... .take(100001)` at 67), `license.ts:20` (`.take(seats+1)`), cron `licenseActions.refresh` every 30 min (`crons.ts:31-36`).
- Problem: the seat/MAU validation counts members by reading up to 100,001 member rows every 30 minutes.
- Impact at 100k: **medium** — a scheduled 100k-row scan 48×/day; wasteful and slow, though not per-user.
- Effort: low.
- Risk: low.
- Proposed fix: keep a maintained member-count field (e.g. on `server`) updated on join/kick/ban, and read that.

### B18. `rateLimits` grows without bound and is written on every send/upload
- Evidence: `packages/convex/convex/lib/rateLimit.ts:45-67` (`rateLimits` insert/patch), schema `schema.ts:708-712` (`by_key` only), used in `messages.send` `messages.ts:206-210`, `files` upload `files.ts:45-54`, `joinAccess` etc. No cron deletes stale rows.
- Problem: one row per `action:user:<id>` and per `action:ip:<addr>` persists forever; there is no TTL/cleanup and no index for expiring old windows. On a shared bucket (unknown IP, CLI) many actors contend on one document.
- Impact at 100k: **medium** — 100k+ permanent rows; each send/upload writes the same user's row (fine) but there is no cleanup and no way to sweep expired windows efficiently.
- Effort: low.
- Risk: low.
- Proposed fix: add a `by_windowStart` (or `by_key_window`) index and a periodic prune of rows whose window is long past; or move to a token-bucket with lazy reset. Ensure per-IP keys cannot collapse to a single hot document when IP is unknown.

### B19. Sealed-value crypto re-derives the data key on every read and write (no per-scope key cache)
- Evidence: `packages/convex/convex/lib/sse.ts:125-145` (`deriveDataKey` does `importKey`+HKDF `deriveKey` per call), called at `sealString` `216` and `openString` `282`; applied per message body in `messages.ts:60-89`, per presence row `presence.ts:162`, per bot log line `botRuntime.ts:179`.
- Problem: the per-record data key depends only on master key + `keyVersion` + `scope` (plus workspace salt) — `recordId` is only in the AAD — yet every open/seal performs two WebCrypto operations (import + derive) before the actual AES-GCM call. There is no cache of derived `CryptoKey`s.
- Impact at 100k: **medium-high** — a 50-message page, `presence.list` over 100k rows, or a bulk decrypt path amplifies this to 2 extra crypto ops per value; it is pure CPU that could be cached.
- Effort: low.
- Risk: low — cache by `(keyVersion, scope)`; do not include `recordId`.
- Proposed fix: memoize `CryptoKey` per `cacheKey(settings,keyVersion)|scope` in a module-level map (cleared by `clearKeyCache`), so only the AES-GCM encrypt/decrypt remains per value.

### B20. `botEvents` outbox is written per message/reaction and pruned at a fixed 50k/hour ceiling
- Evidence: `packages/convex/convex/lib/botEvents.ts:24-39` (one indexed read + insert when any bot is enabled), prune `botEvents.ts:206-222` (`PRUNE_BATCH` 500 × `PRUNE_MAX_BATCHES` 100 = 50k/run), cron hourly `crons.ts:18`.
- Problem: when at least one bot is enabled, every message and reaction inserts a `botEvents` row, but the hourly prune can delete at most 50,000 rows per run. If message volume exceeds 50k/hour the outbox grows without bound even though the retention intent is one hour.
- Impact at 100k: **medium** — a busy workspace easily exceeds 50k messages/hour, so the "one-hour outbox" becomes unbounded storage and slows `poll` (which scans forward in pages).
- Effort: low.
- Risk: low.
- Proposed fix: increase the prune budget / loop more batches, or prune more frequently (e.g. every 10 min), and index `_creationTime` (already used). Consider dropping events when no bot has polled recently.

### B21. `files.getMany`/`get` re-load the full permission context per file (N+1)
- Evidence: `packages/convex/convex/files.ts:326-339` (loop over `fileIds`, `canAccessFile` per file), `canAccessFile` `288-306` → `requireChannelAccessForUser` (`lib/channels.ts:111-121`) → `requirePermissionForUser` → `loadPermissionContext` (`lib/permissions.ts:104-146`, `roles.collect()` + `server.first()`).
- Problem: attachment-heavy messages/kanban cards call `getMany` with up to 20 files; each file re-loads roles + server + resolves permissions, when the context is identical per channel.
- Impact at 100k: **medium** — 20× redundant permission loads per attachment render, and each render is a subscription that re-runs on file changes.
- Effort: low.
- Risk: low.
- Proposed fix: load the permission context once per call, group files by channel/board, resolve access per distinct channel (as `reactions.listForMessages` already does).

### B22. Notes search decrypts and indexes every note body server-side per search
- Evidence: `packages/convex/convex/workspaceNotes.ts:163-181` (loads up to `NOTE_MAX_NOTES` = 2000 pages by `by_updated`, `noteContent` opens each title+body), `lib/workspaceNotes.ts:118-197` tokenizes all documents; `recordRevision` collects all revisions per edit (`lib/workspaceNotesMutations.ts:79-88`).
- Problem: each search decrypts up to 2000 note bodies (2 crypto ops each, per B19) and builds an in-memory inverted index; each note edit collects all revisions (up to `NOTE_MAX_REVISIONS` = 100) to prune.
- Impact at 100k: **medium** — bounded by the addon caps, but a 2000-note decrypt + tokenize per keystroke-driven search is heavy CPU for a workspace using Notes.
- Effort: medium.
- Risk: medium.
- Proposed fix: debounce/limit search input, cap the scanned note window (or maintain a plaintext-token index — noting the encryption constraint), and prune revisions with an index range instead of collecting all.

### B23. `auditLog` has no retention and grows forever
- Evidence: `packages/convex/convex/auditLog.ts:15-23` (`by_at` paginated read), `lib/audit.ts:16-24` (append on many mutations), schema `schema.ts:695-701`; no cron prunes it.
- Problem: every moderation/admin action appends a permanent row; nothing deletes old rows.
- Impact at 100k: **low-medium** — table grows monotonically; `by_at` reads stay paginated so cost is storage/index size rather than per-read blowup.
- Effort: low.
- Risk: low — retention policy is a product decision.
- Proposed fix: add a retention cron using `by_at` (e.g. drop rows older than N months) or an archive export.

### B24. `botRuntime.trimLogs` collects all log rows per append
- Evidence: `packages/convex/convex/botRuntime.ts:150-162` (`botLogs ... by_bot).collect()` 151-154) called from `appendLogs` `186`.
- Problem: every append (frequently, e.g. per stdout line) reads every log row for the bot to enforce the cap.
- Impact at 100k: **low-medium** — bounded by `maxLogLines` per bot, but multiplied by bot count × append frequency; each line also seals individually.
- Effort: low.
- Risk: low.
- Proposed fix: trim with a reverse `by_bot` `.order("desc").take(cap)` and delete the remainder, or track a head pointer; batch log lines per append.

## Storage cleanup candidates

- **`rateLimits`** (`lib/rateLimit.ts`) — no TTL; one row per action/user and action/IP forever. Add expiry prune.
- **`auditLog`** — append-only, no retention (B23).
- **`presence`** — rows persist after a user goes offline; stale rows are never deleted, only marked offline (B5). Consider deleting rows offline longer than a retention window.
- **`typing`** — relies on a 30s cron; expired rows linger up to 30s and the table is scanned wholesale to purge (B6).
- **`callSignals`** — high-volume short-lived rows with no time index; cleanup only via full scan (B11).
- **`botEvents`** — retention intent is 1h but the prune ceiling can be exceeded (B20).
- **`botLogs`** — capped per bot; verify the cap and that deleted bots' logs are purged (`lib/botManagement.ts:137-169`).
- **`devices`** — one row per install + push token; old installs are never expired (no `lastSeen` prune). Consider pruning devices unseen for months.
- **`joinCodes`** / **`inviteRedemptions`** / **`licenseActivity`** — bounded/cleaned on success or reported month; `licenseActivity` is purged per month after final report (good).
- **Oversized rows**: sealed `ciphertext` fields (messages, note pages up to `NOTE_BODY_MAX = 100_000`, bot log lines) carry base64url envelope overhead (~1.33× + IV/tag/header). Bytes live in `_storage` (good); document bodies are the concern for very large notes.

## Already-good notes

- `messages.list` correctly uses `by_channel_thread` with `eq("threadRootId", undefined)` for the roots-only timeline (`messages.ts:274-281`) — the pattern `readStates.summary` should copy (B8).
- `messages.list`/`listThread`/`listPins`/`listThread` use Convex `paginate`; no unbounded message reads on those paths.
- `reactions.listForMessages` batches per-message reaction reads and dedupes/limits message ids (`reactions.ts:109-154`).
- `calls.forChannel` uses `by_channel_status` (`calls.ts:361-374`); `calls.signals` uses `by_call_to`.
- `lib/botEvents.emitBotEvent` no-ops with a single indexed read when no bot is enabled (cheap for workspaces without bots).
- File bytes are stored in `_storage`, and `files.finalize` deletes the plaintext original after sealing (`files.ts:191`).
- Invites store a SHA-256 digest, never the code (`schema.ts:617-632`); join codes store only a hash.
- `rateLimit` is enforced on send/upload/avatar/join (`messages.ts:206-210`, `files.ts:45-54`), which bounds burst fan-out.
- Presence skip for active users in `filterRecipients` avoids waking online users (`lib/messageRecipients.ts:153-160`).
- `usingIndex` coverage is otherwise sensible: `channelMembers.by_channel_user`/`by_user`, `readStates.by_user_channel`, `notificationPrefs.by_user_scope`/`by_user_channel`, `kanbanCards.by_board`/`by_running_timer`, `notePages.by_updated`.
- Kanban/Notes/Kanban cleanup use rescheduled batches (`kanbanCleanup.ts`, `workspaceNotesCleanup.ts`) instead of one giant mutation.

## Measurements/verification ideas

- Instrument per-function read counts for `notifications.unreadSummary`, `members.list`, `presence.list`, `messages.threadInbox` in a staging deployment seeded to 100k members / 10M messages; confirm the read-count and CPU before/after each fix.
- Add a synthetic load harness: N clients each subscribing to the app-wide queries with M heartbeats/sec; measure function invocations/sec and the re-run rate of reactive queries (the `members`/`presence` tables are the churn sources).
- Time the 30s crons at 100k presence rows and typing rows; verify they finish well within 30s and check the reschedule loop count.
- Count `botEvents` inserts vs prune capacity under a message-rate soak to confirm B20's ceiling.
- Profile `lib/sse.ts` open/seal under a page of 50 messages to measure the HKDF overhead share (B19).
- Expose Convex's per-function document-read and transaction-size errors in CI so full-collect regressions surface before production.
