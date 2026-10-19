# Backend performance optimizations — implementation report

Branch: `t3/scale-resource-optimization`
Scope: low-risk, behaviour-preserving optimizations in `packages/convex/`. No schema
changes, no API-contract changes, no data deletion, no user-visible behaviour change.

Verification run from the repo root after each commit:

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 172 files … No fixes applied`
- `bun run --cwd packages/convex test` → `59 passed (59)`, `572 passed (572)`

All three passed after every commit below.

## B19 — Per-scope crypto key cache

- **Status:** done
- **Commit:** `ec58a62`
- **Summary:** Cache the HKDF-derived data key per `(master, keyVersion, workspace, scope)` so repeated/concurrent `sealString`/`openString`/`sealBytes`/`openBytes` calls share one derivation; `recordId` (AAD only) is excluded from the key.
- **Files touched:** `packages/convex/convex/lib/sse.ts`
- **Notes:** Cache stores the `Promise<CryptoKey>` so concurrent derivations dedupe. The new cache is cleared by the existing `clearKeyCache()` (used by key rotation and tests), so key invalidation still takes effect. `deriveDataKey` now takes the `EkmMasterKey` (its `provider|kekId|keyVersion` already identify the master bytes via the master-key cache).

## B8 — Read-state summary: root-only index + hoisted permission context

- **Status:** done
- **Commit:** `02b1944`
- **Summary:** Look up the newest root message with the `by_channel_thread` index (`.eq("threadRootId", undefined)`) instead of `by_channel_created` + a post-index `threadRootId` filter, and load the `PermissionContext` once per `summary` call instead of once per channel.
- **Files touched:** `packages/convex/convex/readStates.ts`, `packages/convex/convex/lib/channels.ts`
- **Notes:** Added `requireChannelAccessFromContext(ctx, context, channelId, flag)` which mirrors `requirePermissionForUser` + the DM/private membership check exactly. The `after` mention-scan query was intentionally left on `by_channel_created` (with its in-code `threadRootId` filter) because moving it to the root-only index would change the `take(MENTION_SCAN_LIMIT)` window semantics and therefore mention counts; only the query that used `.filter(...)` was switched, keeping identical visibility/count results. Non-member/unauthenticated callers still receive `[]`.

## B21 — Batched file access checks in `files.getMany`

- **Status:** done
- **Commit:** `5601034`
- **Summary:** Load the `PermissionContext` once and resolve access per distinct channel/board instead of reloading it per file.
- **Files touched:** `packages/convex/convex/files.ts`, `packages/convex/convex/lib/kanban.ts`
- **Notes:** Added `requireBoardForUserFromContext(ctx, context, boardId, flag)` mirroring `requireBoardForUser` (same kanban-enabled, ban, permission and private-board checks, same order and errors). Board-scoped files keep precedence over channel-scoped files and uploader-only files are unchanged, so access decisions are identical.

## B12 — `activeCalls` reads `by_status` instead of filtering

- **Status:** done
- **Commit:** `0e3312c`
- **Summary:** Fetch `ringing` and `active` directly from the existing `by_status` index and union them in code (sorted by `_creationTime`) instead of scanning the whole `calls` table and post-filtering `status !== "ended"`.
- **Files touched:** `packages/convex/convex/calls.ts`
- **Notes:** The `status` union is `ringing | active | ended`, so the union equals the previous non-ended set. `incoming` was already index-backed and was left untouched. The permission context was already loaded once before the loop, so it stays hoisted.

## B20 — Bot-events prune drains until caught up

- **Status:** done
- **Commit:** `4b98cb7`
- **Summary:** When the final prune batch is full (older rows remain), reschedule `prune` with `runAfter(0)` so a busy workspace is drained across successive runs instead of being capped at 50k rows per hour.
- **Files touched:** `packages/convex/convex/botEvents.ts` (the prune lives here, not in `lib/`; the task path was approximate)
- **Notes:** Keeps the existing loop and `take(PRUNE_BATCH)` batching; each run recomputes the one-hour cutoff, so rows inside the retention window are never deleted and every run stays within one transaction. Uses the same self-reschedule drain pattern as `licenseUsage.purgeIdentities`.

## B24 — `trimLogs` avoids the full collect

- **Status:** done
- **Commit:** `e96743c`
- **Summary:** Read only the newest `cap` rows via `by_bot` ordered `desc`, then delete the older remainder in bounded `take(cap)` batches instead of collecting (and sorting) the bot's entire log history on every append.
- **Files touched:** `packages/convex/convex/botRuntime.ts`
- **Notes:** Convex advances `_creationTime` per `db.insert`, and `by_bot` sorts by it, so the newest `cap` rows are the newest inserted; in the normal case the `at` field increases with insertion, so the surviving set is unchanged. The `BOT_LIMITS.maxLogLines` (500) cap is preserved exactly (the existing runner test asserts 500 after 600 appends).

## Skipped

None. No item required a schema change, API-contract change, data deletion or user-visible behaviour change, so all six landed.

## Commit list

```
e96743c perf(botRuntime): trim logs without collecting the whole history (B24)
4b98cb7 perf(botEvents): keep draining prune until caught up (B20)
0e3312c perf(calls): read live calls from by_status instead of filtering (B12)
5601034 perf(files): batch getMany access checks per channel/board (B21)
02b1944 perf(readStates): index root messages and reuse permission context (B8)
ec58a62 perf(sse): cache derived data keys per scope (B19)
```
