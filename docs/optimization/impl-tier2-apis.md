# Tier-2 backend APIs — implementation report

Branch: `t3/scale-resource-optimization`
Scope: **additive** backend queries in `packages/convex/` that let the web and
mobile clients stop full-collecting `members` and `presence`. Every existing
query (`members.list`, `presence.list`, `presence.get`) keeps its exact
signature and return shape; its handler behaviour is unchanged except for the
documented safety bound in item 4. Clients migrate in a later, coordinated wave,
after which the old queries can be tightened.

Verification run from the repo root after **every** commit:

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 178 files … No fixes applied`
- `bun run --cwd packages/convex test` → `60 passed (60)`, `587 passed (587)`

`convex codegen` cannot run offline (no `CONVEX_DEPLOYMENT`). The new index comes
from `schema.ts` via `_generated/dataModel.d.ts`; the new queries live in
existing modules, so no `_generated/api.d.ts` edit was required.

## New function paths, signatures and caps

| Path | Arguments | Returns | Cap / bound | Replaces |
| --- | --- | --- | --- | --- |
| `api.members.page` | `{ cursor?: string, numItems?: number }` | `{ page: MemberView[], isDone, continueCursor }` | `numItems` default **100**, hard **500**; rows resolved per page | `api.members.list` (directory read) |
| `api.members.search` | `{ query: string, limit?: number }` | `MemberView[]` | matches default **25**, hard **100**; scan window **500** rows of `by_joined` | `api.members.list` + client-side filter (mention autocomplete / member picker) |
| `api.presence.getMany` | `{ userIds: string[] }` | presence rows (same shape as `presence.list` entries) | de-duplicated, hard **300** ids; per-id `presence.by_user` lookups | `api.presence.list` (scoped to a channel's members/view) |
| `api.presence.list` | `{}` (unchanged) | unchanged | hard `.take(1000)` safety bound added; shape/order unchanged | — (still available; bound only) |

`MemberView` is exactly the entry `members.list` returns: `id`, `userId`,
`nickname`, `accountName`, `isBot`, `roleIds`, `joinedAt`, `timeoutUntil`,
`avatarUrl`. The presence row is exactly `presence.list`'s: `userId`, `status`,
`customStatus` (decrypted), `lastHeartbeat`.

## What changed per item

### 1. `members.page` — paginated member directory
- **Commit:** `294602c`
- **Files:** `packages/convex/convex/schema.ts`, `packages/convex/convex/members.ts`, `packages/convex/test/members-directory.test.ts`
- Added `by_joined` index on `members.joinedAt`. `members.page` paginates it with
  `.paginate({ numItems, cursor })` in ascending join order (the order
  `members.list` sorts by). `numItems` is clamped to `[1, 500]`, default `100`.
  Account names and avatar URLs are resolved only for the page's rows. Returns
  `{ page, isDone, continueCursor }`.

### 2. `members.search` — search-as-you-type directory
- **Commit:** `99f2803`
- **Files:** `packages/convex/convex/members.ts`, `packages/convex/test/members-directory.test.ts`
- Case-insensitive match on nickname or the **resolved** account display name
  (profile name, else email local part — via the shared `accountNames` helper);
  results are `MemberView` in join order. One `by_joined` index window of at most
  `MEMBER_SEARCH_SCAN_LIMIT = 500` rows, returning at most `limit` (default 25,
  cap 100) matches. Convex permits only one `.paginate()` per function, so the
  window is a single `.take(500)`; a miss costs one window, never the table.
  Documented in the handler comment.

### 3. `presence.getMany` — scoped presence
- **Commit:** `fbb2d8a`
- **Files:** `packages/convex/convex/presence.ts`, `packages/convex/test/presence.test.ts`
- De-duplicates the requested ids, caps them at `PRESENCE_GET_MANY_MAX = 300`,
  and looks each up through the `presence.by_user` index (batched with
  `Promise.all`) instead of collecting the table. Returns the identical row
  shape, including the decrypted custom status. The row mapping was factored
  into a shared `toPresenceRow` helper, now used by `list`, `get` and `getMany`
  so the three cannot drift.

### 4. B10 follow-up — `presence.list` safety bound
- **Commit:** `07cb045`
- **Files:** `packages/convex/convex/presence.ts`
- `presence.list` semantics and return shape are unchanged, but the read is now
  `.take(PRESENCE_LIST_LIMIT)` with `PRESENCE_LIST_LIMIT = 1000` and a comment,
  so a not-yet-migrated client cannot trigger an unbounded read. The bound is far
  above a typical workspace's presence rows, so ordinary clients still see every
  row. Not skipped — existing tests (1-row lists) are unaffected.

## Client migration (later wave)

- Member directory: `members.list` → `members.page` (walk `continueCursor`
  until `isDone`).
- Mention autocomplete / member picker: `members.list` + filter →
  `members.search`.
- Presence: `presence.list` → `presence.getMany` with the channel's member ids.
- `members.list`, `presence.list` and `presence.get` remain available unchanged
  until then.

## Tests

- `packages/convex/test/members-directory.test.ts` (new): `members.page` returns
  the same rows/shape as `members.list` in join order and pages by cursor; page
  size defaults (100), clamps up (`0 → 1`), caps (501 rows, `numItems: 10_000`
  → 500) and resumes at the tail. `members.search` matches nicknames and resolved
  account names / email local parts case-insensitively, honours `limit` in join
  order, and never scans past its 500-row window (a match at row 501 is not
  found; one inside the window is).
- `packages/convex/test/presence.test.ts`: `presence.getMany` returns the same
  rows as `presence.list` for the requested ids (de-duplicated, order preserved,
  unknown ids skipped), caps at 300 ids, and requires membership.

## Final verification

- `bun run --cwd packages/convex typecheck` → clean
- `bun run --cwd packages/convex lint` → `Checked 178 files … No fixes applied`
- `bun run --cwd packages/convex test` → `60 passed (60)`, `587 passed (587)`

No item was skipped.
