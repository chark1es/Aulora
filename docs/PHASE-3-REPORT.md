# Phase 3 — Roles: Gate Report

Date: 2026-09-26. Gate: **a permission test suite covering the resolution order and hierarchy passes.**

**Verdict: PASS** — independently verified: 323 tests green on a forced run, every resolution
rule mapped to a test, and live falsification attempts all held on a fresh stack.

## What shipped

- **`packages/convex`**: `roles.ts` (CRUD, reorder by position, `@everyone` pinned at 0, grant
  ceiling, MLS removals on permission change), `members.ts` (role assignment, kick, ban/unban/list,
  timeout, nickname — all hierarchy-checked), `categories.ts` + `channels.ts` overrides
  (`{targetId, targetType, allow, deny}`), `auditLog.ts` (paginated, `ViewAuditLog`), `invites.ts`
  (hashed one-time codes with maxUses/expiry/revocation, idempotent redeem), and `lib/permissions.ts`
  wiring `requirePermission`/`canModerate`/`canManageRole`/`canGrantPermissions` to `@aulora/core`
  `resolvePermissions`, returning `mlsAction` when a change removes `ViewChannel`.
- **`apps/web` + `packages/ui-web`/`avatars`**: role editor (create/edit/delete/reorder; name,
  color, grouped permission toggles, hoisted, mentionable), member manager (roles, nickname,
  timeout, kick, ban/unban + ban list), category + channel override editors, workspace settings,
  invites (create/copy/revoke) + `/invite/:code` redeem route, paginated audit viewer, and the
  role color as a 2px blobatar ring + tinted usernames.
- UI gating is cosmetic only; every mutation re-checks server-side.

## Gate evidence (independent)

- **Rule→test mapping: no gaps.** Owner/Administrator bypass; `@everyone` then OR held roles;
  category→channel ordering; the exact role-deny → role-allow → member-deny → member-allow order;
  hierarchy equal/higher blocked; cannot-grant-above-self. (Only nit: no convex test seeds an
  Administrator role — the unit suite covers it.)
- `turbo run test --force` → **7/7 tasks, 323 passed, 0 failed** (core 115 incl. 28 permission
  cases; convex 119; web 35; crypto 26; tokens 11; avatars 6; ui-web 11). Typecheck 7/7, lint 8/8.
- **Live falsification (fresh stack):** a member without `ManageChannels` calling `channels:create`
  → `ConvexError: Missing permission`; a role-granted `messages:pin` stopped working after a
  role-deny override (override beats role allow); an `@everyone` ViewChannel-deny channel was
  absent from `channels.list` and `channels.get` denied.
- Full **Playwright suite on the fresh stack: 5 passed**.

## Known caveats / deferred

- No convex test seeds an Administrator role (covered in core unit tests).
- Not yet e2e-driven: role delete/reorder, ban/unban, category-level overrides and deny/clear,
  audit "Load more", allowed email domains.
- Role-color ring/tint is unit-covered only, not visually asserted.

## Next: Phase 4

Tauri desktop (macOS polish first), Expo iOS/Android, deep links, and desktop + web push; gate is
one account working on all five clients. **Blocker to flag:** the macOS host
`charles-macbook-air` did not resolve from the build environment, so macOS/iOS builds and the
five-client gate need a reachable host or CI.
