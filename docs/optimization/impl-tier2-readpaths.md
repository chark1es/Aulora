# Tier-2 server read-path optimizations — implementation report

Branch: `t3/scale-resource-optimization`
Scope: approved Tier‑2 backend **read‑path** optimizations in `packages/convex/`. Every
item keeps the client‑visible query/mutation shape **identical** (same arguments, same
return shape) so the current web and mobile clients keep working unchanged. No item
touches `members.list`, `presence.list` or another public signature scheduled for the
later coordinated client wave.

Verification run from the repo root after **every** commit:

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 177 files … No fixes applied`
- `bun run --cwd packages/convex test` → `59 passed (59)`, final `578 passed (578)`

`convex codegen` cannot run offline (no `CONVEX_DEPLOYMENT`). Schema additions
typecheck from `schema.ts` via `_generated/dataModel.d.ts`; no new module files were
added (helpers went into existing `lib/*` modules), so `_generated/api.d.ts` needed no
manual edit.

## Client changes required

**None for any item.** Every change is server-internal, preserving arguments, return
shape and ordering.

## Backfills to run after deploy

- **`maintenance:backfillInstanceCounters`** (B16) — seeds the maintained admin-overview
  counters (`instanceSettings.fileCount`/`fileBytes`/`channelCount`/`deviceCount`).
  Idempotent, paged, self-rescheduling across files → channels → devices; creates the
  singleton settings row with defaults when absent. Before it runs, `instance.overview`
  falls back to a bounded (saturating) scan, so nothing breaks.

No backfill is required for B1, B4, B7, B9, B10, B13 or B22.

---

## Item results

### B1 — bound `notifications.unreadSummary`
- **Status:** done
- **Commit:** `dd762b1`
- **Files:** `packages/convex/convex/notifications.ts`, `packages/convex/test/notifications.test.ts`
- **What changed:** Replaced the per-channel `messages.withIndex("by_channel_created").collect()`
  (entire history) with a resolved cursor timestamp and an index **range**:
  `by_channel_created` with `.gt("_creationTime", cursorTime)` (or from the channel start
  when there is no cursor), truncated with `.take(UNREAD_SCAN_LIMIT)` (`100`). The count
  saturates at the limit (the badge shows `99+`). A cursor that no longer resolves in the
  channel reads as fully read, matching the old positional `findIndex === -1` behaviour.
  Return shape `{ total, mentions }` and the other-author / non-deleted / non-system
  semantics are unchanged.
- **Client change needed:** no
- **Tests added:** saturation test (130 messages ⇒ `{ total: 100, mentions: 10 }`); existing
  small-channel/tail test still asserts exact counts.
- **Verification:** typecheck clean, lint clean, `notifications.test.ts` 15 passed, full suite passed.

### B9 (read path) — `messages.threadInbox` uses `threadParticipants`
- **Status:** done
- **Commit:** `773b8c0`
- **Files:** `packages/convex/convex/lib/threadInbox.ts`, `packages/convex/convex/messages.ts`, `packages/convex/test/messagesThreads.test.ts`
- **What changed:** Replaced the global `query("messages").order("desc").take(1000)` scan
  with the caller's `threadParticipants.by_user` rows (newest-first, bounded at
  `THREAD_INBOX_CANDIDATE_LIMIT = 200`), then loads the referenced thread **roots**,
  filters to channels the viewer can still view (unchanged logic), orders by activity and
  keeps the `50`-row response cap. Reply-derived fields (`participantIds`,
  `mentionedUserIds`, `viewerParticipated`) are reconstructed per returned thread from the
  bounded `by_thread` replies so the exact previous semantics (e.g. a mention-only viewer
  is not `viewerParticipated`) are preserved; `replyCount`/`lastReplyAt` still come from
  the maintained root fields. Same row fields/order, same 50 cap.
- **Client change needed:** no
- **Tests added:** reads from the participant index (direct `threadParticipants` rows) and
  caps the response at 50 threads, newest-first.
- **Verification:** typecheck clean, lint clean, `messagesThreads.test.ts` 9 passed, full suite passed.

### B10 — resolve notification recipients once
- **Status:** done
- **Commit:** `e56a9ea`
- **Files:** `packages/convex/convex/lib/messageRecipients.ts`, `packages/convex/convex/notifications.ts`, `packages/convex/convex/messages.ts`
- **What changed:**
  - (a) presence is now read only for candidate user ids via `presence.by_user` instead of
    `presence.collect()`.
  - (b) preferences are fetched in a single grouped pass (`loadPrefsByUser`) rather than a
    `notificationPrefs` collect per candidate; the chosen-pref rule (channel wins over
    server, default `all`) is unchanged.
  - (c) `messages.send` schedules a single `dispatchForMessage`, which resolves recipients
    **once** and hands the resolved ids to `dispatchMobileForMessage` (new optional
    `recipients` arg; it still resolves itself when invoked standalone). The action no-ops
    early when neither transport is configured, preserving the `unconfigured` result.
- **Client change needed:** no
- **Tests:** none added — covered by existing `notifications.resolveRecipients`,
  `dispatchForMessage` and `pushRelay.dispatchMobileForMessage` suites (recipients and
  online-skip behaviour unchanged).
- **Verification:** typecheck clean, lint clean, full suite passed.

### B4 — lighter presence heartbeat
- **Status:** done
- **Commit:** `1cab62b`
- **Files:** `packages/convex/convex/lib/permissions.ts`, `packages/convex/convex/lib/licenseActivity.ts`, `packages/convex/convex/presence.ts`
- **What changed:** `requireMember` now returns the resolved member row (`null` for the
  owner) so the heartbeat can pass `{ isMember }` to `recordLicenseActivity`, which skips
  its own member-row read. `recordLicenseActivity` already returns before any member/usage
  lookup when the server has no active licence; that early return is now explicit. Heartbeat
  cadence and presence-row semantics are unchanged.
- **Client change needed:** no
- **Tests:** none added — covered by `license-usage.test.ts` (heartbeat counts once per
  member/month; owner/member paths) and `presence.test.ts`.
- **Verification:** typecheck clean, lint clean, full suite passed.

### B7 — bound the mark-read mention count
- **Status:** done
- **Commit:** `3898fcf`
- **Files:** `packages/convex/convex/readStates.ts`, `packages/convex/test/readStates.test.ts`
- **What changed:** `countMentionsAfter` no longer `collect()`s the channel; it resolves the
  cursor message's `_creationTime` and reads an index range
  (`by_channel_created` `.gt("_creationTime", cursorAt)`, or from the start) truncated at
  the shared `MENTION_SCAN_LIMIT` (`200`). Non-deleted / `mentionUserIds` semantics inside
  the window are unchanged (self-mentions still count, as before); a stale cursor still
  reads as zero.
- **Client change needed:** no
- **Tests added:** saturation test (250 mentions after the cursor ⇒ `200`); existing
  cursor/deleted/other-user tests still pass.
- **Verification:** typecheck clean, lint clean, `readStates.test.ts` 11 passed, full suite passed.

### B13 — bound/prune `channels.visibleMemberIds`
- **Status:** done
- **Commit:** `426796e`
- **Files:** `packages/convex/convex/lib/channelHelpers.ts`, `packages/convex/test/channels.test.ts`
- **What changed:** Private/DM channels already answer from `channelMembers` in the query
  handler. For public channels, roles are loaded once and each member's resolved bitfield is
  **memoized by role set** so members sharing roles (the common `@everyone`-only case) do not
  re-resolve the same role bitfields. The owner short-circuits to `ALL_PERMISSIONS`. Member
  overrides are user-specific, so the role-set memo is only used when neither the channel nor
  category overrides contain member entries; otherwise it falls back to per-member resolution.
  The returned id set is identical.
- **Client change needed:** no
- **Tests added:** visibility per role set (a role override denies two members sharing a role
  while a third stays visible); existing member-override and private-channel tests still pass.
- **Verification:** typecheck clean, lint clean, `channels`/`overrides`/`authorization` 53 passed, full suite passed.

### B16 — admin overview without full collects
- **Status:** done
- **Commit:** `5b436d7`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/lib/instance.ts`, `packages/convex/convex/instance.ts`, `packages/convex/convex/files.ts`, `packages/convex/convex/kanbanCleanup.ts`, `packages/convex/convex/channels.ts`, `packages/convex/convex/lib/channelHelpers.ts`, `packages/convex/convex/devices.ts`, `packages/convex/convex/maintenance.ts`, `packages/convex/convex/auditLog.ts`, `packages/convex/test/instance.test.ts`
- **What changed:** Added maintained counters on `instanceSettings`
  (`fileCount`, `fileBytes`, `channelCount`, `deviceCount`, all optional) updated at the
  relevant write paths — file finalize (`files.insertFinalized`) and delete
  (`kanbanCleanup.deleteFile`), channel create (`channels.create`, `createDmChannel`), and
  device upsert/revoke/prune. `instance.overview` prefers the counters and reuses
  `server.memberCount` for members; before backfill (absent fields) it falls back to a scan
  bounded by `OVERVIEW_SCAN_LIMIT` (`5000`), documented as saturating on very large instances.
  Added the idempotent `maintenance.backfillInstanceCounters` migration. `auditLog.list` now
  resolves nicknames only for the ids on the current page instead of collecting all members.
- **Client change needed:** no (the `instance.settings` shape is untouched; `instance.overview`
  keeps the same fields)
- **Tests added:** run the backfill then assert seeded counts/`usedBytes` and that a device
  write updates the maintained counter. Existing overview test (no backfill) still passes via
  the fallback.
- **Verification:** typecheck clean, lint clean, `instance`/`audit`/`files`/`devices` 27 passed, full suite passed.
- **Notes / deviation:** the task preferred counters; counters are implemented for the four
  counts and file bytes. The bounded scan remains only as the pre-backfill fallback, and as
  the members path fallback until `backfillMemberCount` has run.

### B22 — bound/debounce notes search
- **Status:** done
- **Commit:** `c0e6354`
- **Files:** `packages/convex/convex/workspaceNotes.ts`, `packages/convex/convex/lib/workspaceNotes.ts`, `packages/convex/convex/lib/workspaceNotesMutations.ts`, `packages/convex/test/workspace-notes.test.ts`
- **What changed:** `workspaceNotes.search` now scans at most `NOTE_SEARCH_SCAN_LIMIT`
  (`300`, well below the `2000` max) newest-first, bounding decryption while keeping results
  ordered and complete within the window; response shape unchanged. `recordRevision` prunes
  with an index range — `.order("desc").take(NOTE_MAX_REVISIONS + REVISION_PRUNE_BATCH)` then
  deletes the remainder — instead of collecting every revision.
- **Client change needed:** no
- **Tests added:** search is bounded to the most recently updated notes (an out-of-window
  term returns `[]`; in-window terms still match). Existing revision-limit prune test still passes.
- **Verification:** typecheck clean, lint clean, `workspace-notes.test.ts` 14 passed, full suite passed.

---

## Final verification

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 177 files … No fixes applied`
- `bun run --cwd packages/convex test` → `59 passed (59)`, `578 passed (578)`

No item was skipped.
