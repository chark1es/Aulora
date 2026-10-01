> Archived work record. This file can describe removed code or unresolved work that has since changed. Use [the current documentation](../README.md) and [project status](../project-status.md).

> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phase 4.3 — Aulora push + deep links: Gate Report

Date: 2026-09-26. Scope: web push (VAPID), deep links across web/desktop, and
the desktop unread badge. Companion to `PHASE-4-DESKTOP-REPORT.md` and
`PHASE-4-MOBILE-REPORT.md`.

**Verdict: verified as far as an offline Windows host allows.** Unit tests,
typecheck, lint and a production web build pass. Nothing was delivered to a
real browser push service and nothing was compiled as a Tauri binary, so live
push receipt and native deep-link registration are delegated to CI/an operator.

## What shipped

- **`packages/convex`**
  - `lib/webPush.ts`: a VAPID (RFC 8292) sender on the default Convex runtime.
    Builds an ES256 JWT with `crypto.subtle` and posts an **empty-body** push
    (`TTL`, `Authorization: vapid t=…, k=…`); `parseSubscription`,
    `vapidConfigFromEnv`, `base64url` helpers.
  - `notifications.ts`: `getPrefs`/`setPref` (server + channel scopes, mute
    until), `unreadSummary` (live unread/mention totals from read cursors),
    `resolveRecipients` (drops the author, honours level/mentions/mute and skips
    users active within 60 s), `deviceSubscriptions`, and the
    `dispatchForMessage` action. `messages.send` schedules it via
    `ctx.scheduler.runAfter(0, …)`.
  - `server:publicConfig` now exposes the (public) `webPush.publicKey`.
- **`apps/web`**
  - `public/push-sw.js`: push → content-free notification; click focuses the
    app or opens a tab.
  - `lib/web-push.ts`: VAPID subscribe, subscription serialization, device
    upsert into `devices.pushToken`; `useWebPush` wires it from the runtime.
  - `useLiveUnreadBadge`: streams `unreadSummary` into `set_unread_badge`
    (desktop) and `navigator.setAppBadge`; the old arrival counter is removed.
  - `parseDeepLink` now accepts `https` universal links (`/connect?server=`,
    `/invite/:code`) as well as `aulora://`.
- **`infra/docker/proxy/Caddyfile.example`**: explicit `worker-src 'self'`.
- VAPID generation already lives in `infra/docker/setup` (`vapid.mjs`,
  `entrypoint.sh`); confirmed it persists `VAPID_*` and exposes only the public
  key.

## Design notes

- The Convex default runtime signs ECDSA P-256 but does **not** implement ECDH
  `deriveBits` (get-convex/convex-backend#399), so RFC 8291 payload encryption
  is not possible there. Pushes are therefore content-free wakes; the service
  worker shows a device-computed "New message". Opaque-id payloads stay a
  documented follow-up (a Node action or the push relay when mobile push lands).
- Preferences resolve channel-over-server; level `nothing` and a future
  `muteUntil` suppress delivery; `mentions` requires the user in
  `mentionUserIds` (plaintext by design).

## Verified locally

- `bun run test` — **366 tests pass**: convex 134 (notifications 8, webPush 7,
  incl. real key generation + JWT verification against a stubbed fetch), web 50
  (web push 6, deep links, invites), plus the existing suites.
- `bun run typecheck` — 9/9 tasks; `bun run lint` — 11/11.
- Web production `vite build` passes and copies `dist/push-sw.js`. The new
  Playwright spec (`e2e/phase4-deeplinks.spec.ts`, no credentials needed) was
  authored but not run here (it needs a reachable web origin).

## Not verified locally

- **Real push delivery.** No browser/OS push service was contacted; encryption,
  TTL handling and notification display are unit-level only. iOS Safari web push
  additionally needs an installed PWA.
- Tauri build, deep-link scheme registration and a runtime `aulora://` handoff.
- The deep-link e2e spec needs a reachable web origin.
