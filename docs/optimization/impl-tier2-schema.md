# Tier-2 schema / bounded-sweep / retention optimizations — implementation report

Branch: `t3/scale-resource-optimization`
Scope: approved Tier-2 backend optimizations in `packages/convex/`. Every item is an
additive schema/index change, a bounded sweep, or a retention/backfill migration.
Read/write behaviour and API contracts are preserved; no `dist/`/build output is
committed.

Verification run from the repo root after **every** commit:

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 177 files … No fixes applied`
- `bun run --cwd packages/convex test` → `59 passed (59)`, `572 passed (572)`

`convex codegen` cannot run offline (no `CONVEX_DEPLOYMENT`). Table/index
additions typecheck from `schema.ts` via `_generated/dataModel.d.ts`, and new
modules were hand-added to `_generated/api.d.ts` following the generated
alphabetical pattern.

## Backfills to run after deploy (in order)

All three are idempotent internal mutations on the new `maintenance` module and
self-reschedule, so one invocation drains the whole workspace.

1. **`maintenance:backfillMemberCount`** — seeds `server.memberCount` from a
   member recount. Until it runs, `license.validationInput` keeps using the
   capped member scan.
2. **`maintenance:backfillMemberRoles`** — seeds the `memberRoles` reverse index
   from `members.roleIds`. Until it runs, `roles.remove` keeps using the legacy
   member scan.
3. **`maintenance:backfillThreadParticipants`** — seeds `threadParticipants` from
   thread roots' `replyParticipantIds` + `mentionUserIds`. Nothing reads this
   table yet, so the timing is not urgent.

Run with, e.g.:

```bash
npx convex run maintenance:backfillMemberCount
npx convex run maintenance:backfillMemberRoles
npx convex run maintenance:backfillThreadParticipants
```

No backfill is required for B5, B6, B11, B15, B18/S1, S2, S3/S6: those only add
indexes (backfilled by Convex on deploy) and additive columns.

## Item results

### B5 — `presence` stale sweep by index
- **Status:** done
- **Commit:** `1582d1c`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/presence.ts`
- **Summary:** Added `by_lastHeartbeat`; `presence.sweepStale` now pages only
  rows past the idle cutoff with `withIndex("by_lastHeartbeat", q => q.lt(...))`
  and `.paginate(...)`, patching only those rows and rescheduling (with the
  pagination cursor) while a page is full. Idle/offline thresholds, `manual`
  semantics and the 30s cron cadence are unchanged.
- **Migration:** none.
- **Notes / deviation:** the approved sketch suggested a plain `.take(batch)` +
  reschedule with `{}`. Patching `status` does not move `lastHeartbeat`, so a
  front re-scan would loop forever on the same stale rows. A cursor (passed to
  the follow-up run) is what gives the drain forward progress; the cron still
  invokes it with `{}`.

### B6 — `typing` indexes + bounded purge
- **Status:** done
- **Commit:** `53526b9`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/typing.ts`
- **Summary:** Added `by_channel_user` and `by_expires`. `typing.set`/`clear`
  use a single `.unique()` lookup instead of collecting the channel's rows;
  `purgeExpired` reads only `expiresAt < now` via `by_expires`, deletes a bounded
  batch and reschedules while a full batch remains.
- **Migration:** none.

### B11 — call sweeps by index
- **Status:** done
- **Commit:** `0753f96`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/calls.ts`
- **Summary:** Added `by_lastSeen` (`callParticipants`) and `by_created`
  (`callSignals`). The sweep deletes stale participants/signals past their
  cutoffs in bounded batches (rescheduling while full), reads live `calls` from
  the existing `by_status` index for `ringing`/`active`, and prunes
  ended-past-retention calls from the same index.
- **Migration:** none.
- **Notes:** `endCall` already deletes a call's participants and signalling, so
  dropping the sweep's per-participant `db.get(callId)` ended/absent check keeps
  the same end state (stale seats removed, signalling cleaned, timed-out calls
  ended, ended calls pruned after retention).

### B15 — `channels` list by index
- **Status:** done (with a documented deviation on the index choice)
- **Commit:** `738c445`
- **Files:** `packages/convex/convex/channels.ts`
- **Summary:** `channels.list` now reads `withIndex("by_dm_key", q => q.eq("dmKey", undefined))`,
  which selects non-DM channels in creation order, so pagination no longer walks
  past every DM/group-DM row.
- **Migration:** none.
- **Notes / deviation:** no `by_kind` index was added, and no `by_archived_kind`
  is needed because `list` does not filter `archived`. A single paginated Convex
  index range cannot span the three non-DM `kind` values (`announcement`,
  `text`, `voice`) — they are not contiguous in string order — so `by_kind`
  cannot serve this query. DMs/group DMs are the only rows the app inserts with
  a `dmKey` (both insert sites verified), so `by_dm_key == undefined` is the
  precise "not a DM" index and preserves ordering, page size and cursor
  behaviour exactly. The `kind` filter is kept as an invariant guard for any row
  that reaches the table without a `dmKey` (e.g. test fixtures), so behaviour is
  identical even for anomalous rows.

### B18 + S1 — `rateLimits` index + TTL prune
- **Status:** done
- **Commit:** `f11371f`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/rateLimits.ts` (new), `packages/convex/convex/_generated/api.d.ts`, `packages/convex/convex/crons.ts`
- **Summary:** Added `by_window_start` and an hourly `pruneRateLimits` cron that
  deletes counters whose `windowStart` is older than a documented 7-day
  retention (`RATE_LIMIT_RETENTION_MS`), in bounded batches, rescheduling while
  full. Far longer than any configured window, so retained counters can never
  still be read; the algorithm is untouched.
- **Migration:** none.

### B17 — maintained member count
- **Status:** done
- **Commit:** `0ed3f1a`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/lib/memberCount.ts` (new), `packages/convex/convex/maintenance.ts` (new), `packages/convex/convex/_generated/api.d.ts`, `packages/convex/convex/lib/membership.ts`, `packages/convex/convex/members.ts`, `packages/convex/convex/setupState.ts`, `packages/convex/convex/bots.ts`, `packages/convex/convex/lib/botManagement.ts`, `packages/convex/convex/license.ts`
- **Summary:** Added optional `server.memberCount`, maintained on every member
  insert/delete (auth join, invite/allowlist join via `admitMember`, bot create,
  kick, ban, bot-user teardown, bootstrap). `license.validationInput` reads it
  when present and otherwise falls back to the original capped scan.
- **Migration:** **`maintenance:backfillMemberCount`** — seed from a member
  recount (paged, self-rescheduling, safe to re-run).

### S2 — audit-log retention
- **Status:** done
- **Commit:** `3e11919`
- **Files:** `packages/convex/convex/auditLog.ts`, `packages/convex/convex/crons.ts`
- **Summary:** Added `pruneAuditLog` and a daily cron; deletes only rows with
  `at` older than a documented 180-day window
  (`AUDIT_LOG_RETENTION_MS`), via `by_at`, batched and rescheduled. `list` is
  unchanged.
- **Migration:** none.

### S3 + S6 — stale presence/devices cleanup
- **Status:** done
- **Commit:** `56d6551`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/presence.ts`, `packages/convex/convex/devices.ts`, `packages/convex/convex/crons.ts`
- **Summary:** Added `by_lastSeen` to `devices`. Daily `pruneStalePresence`
  (delete presence `lastHeartbeat` older than 30 days via `by_lastHeartbeat`) and
  `pruneStaleDevices` (delete devices `lastSeen` older than 180 days via
  `by_lastSeen`), each batched and rescheduled; rows inside the window are never
  deleted.
- **Migration:** none.

### B14 — `memberRoles` reverse index + backfill
- **Status:** done
- **Commit:** `c83f829`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/lib/memberRoles.ts` (new), `packages/convex/convex/lib/membership.ts`, `packages/convex/convex/members.ts`, `packages/convex/convex/setupState.ts`, `packages/convex/convex/lib/botManagement.ts`, `packages/convex/convex/roles.ts`, `packages/convex/convex/maintenance.ts`, `packages/convex/convex/_generated/api.d.ts`
- **Summary:** Added the `memberRoles` table (`by_role`, `by_user_role`),
  dual-written on every role change. `roles.remove` now detaches only members
  holding the role via `by_role`, in bounded batches, rescheduling while more
  remain (`roles.detachRole`). `members.roleIds` stays authoritative for reads.
  A workspace whose reverse table is still empty (pre-backfill) falls back to
  the original member scan so nothing regresses.
- **Migration:** **`maintenance:backfillMemberRoles`** — seed from
  `members.roleIds` (paged, self-rescheduling, idempotent). Run it before relying
  on the indexed `roles.remove` path for pre-existing role assignments.

### B9 (server side) — `threadParticipants` table + backfill
- **Status:** done
- **Commit:** `c67c4eb`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/lib/threadParticipants.ts` (new), `packages/convex/convex/messages.ts`, `packages/convex/convex/maintenance.ts`, `packages/convex/convex/_generated/api.d.ts`
- **Summary:** Added the `threadParticipants` table (`by_user`,
  `by_thread_user`). `messages.send` upserts a row for every reply (author
  becomes a participant) and for every mentioned user in a root or reply
  (`lastReplyAt` moves forward only, `mentioned` ORs true). The `threadInbox`
  read path is intentionally unchanged.
- **Migration:** **`maintenance:backfillThreadParticipants`** — seed from thread
  roots' `replyParticipantIds` + `mentionUserIds` (paged, self-rescheduling,
  idempotent). No read path depends on the table yet.

## Final verification

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 177 files … No fixes applied`
- `bun run --cwd packages/convex test` → `59 passed (59)`, `572 passed (572)`

No item was skipped.
