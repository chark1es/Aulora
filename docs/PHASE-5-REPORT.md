> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phase 5 — Keys + mobile push: Gate Report

Date: 2026-09-26. Scope: device verification, recovery-passphrase key backup,
history sharing for new devices and members, and the project push relay plus
the Convex action that routes to it. Companion to the Phase 4 gate reports.

**Verdict: backend, crypto and relay logic are verified on an offline Windows
host; every device-only or credential-only step is called out below.** Scope
gate from `plan.md` is *"New phone restores history from backup and gets push"*:
the restore path and the wake routing are implemented and unit/integration
tested, but a real phone, Apple/Google credentials and the OpenMLS native build
are still required to complete the on-device half.

## What shipped

- **`packages/crypto`** (Phase 5 primitives, all pure JS):
  - `safety-number.ts`: canonical, symmetric 60-digit device fingerprints
    (SHA-512, 12×5 digits), constant-time comparison, and `aulora://verify?d=…`
    QR payloads (native and https universal links).
  - `key-backup.ts`: Argon2id (RFC 9106, defaults 64 MiB / t=3 / p=1) key
    derivation plus an AES-256-GCM envelope for identity and channel history
    keys; strict KDF-parameter validation and a versioned envelope.
  - `history-sharing.ts`: X25519 ephemeral-static ECDH + HKDF-SHA256 +
    AES-256-GCM envelopes that seal channel history keys to a new device's
    sharing key; sharing identities persist encrypted in the key store.
- **`packages/convex`**:
  - `devices`: `sharingKey`, `verifiedAt`, and a `deviceApprovals` audit table.
    `approve` bootstraps the first device and otherwise requires an existing
    verified approver plus a 60-digit number; `revoke`, `sharingKeys`,
    `hasVerifiedDevice`, `approvals`.
  - `keyBackups`: per-user `get`/`put`/`remove` of the opaque Argon2id blob.
  - `history`: archive snapshots (`putArchive`/`listArchives`) and the
    request/share/list/consume flow for sealed history bundles.
  - `lib/pushRelay.ts` + `notifications.dispatchMobileForMessage`:
    content-free wake routing; `messages.send` schedules it beside the web-push
    dispatch. Native tokens and web-push subscriptions are kept disjoint.
- **`infra/push-relay`**: a dependency-free Node service implementing the
  contract below, with APNs (ES256 token auth), FCM HTTP v1 and UnifiedPush
  adapters, strict field allowlisting, bearer auth and an 8 KiB cap; Dockerfile
  and a real `docker compose --profile push-relay` build.
- **`apps/mobile`**: `device-verification.ts` (hex identity → fingerprint,
  constant-time confirm, QR payload) and `key-recovery.ts` (Argon2id
  build/restore + passphrase guard) as the tested seams for the two user flows.

## Relay contract

`POST /v1/wake`, `Authorization: Bearer <PUSH_RELAY_TOKEN>`:

```json
{ "v": 1, "serverId": "…", "channelId": "…", "messageId": "…",
  "platform": "ios|android|unifiedpush", "token": "…" }
```

`202 {"accepted":true,"provider":"apns"}`; `400` malformed/unknown field,
`401` bad token, `404/405` wrong path/method, `413` body > 8 KiB, `502`
provider failure, `503` no provider for that platform. No message text,
sender name or key material is ever accepted or forwarded; downstream bodies
are rebuilt from the allowlist, never forwarded verbatim.

## Design notes

- **Trust root bootstrap.** A new device registers unverified. The account's
  first authenticated device bootstraps verification; every later device needs
  an existing verified device's approval. A device can never approve another
  user's device, and the server stores only public keys.
- **Why Argon2id.** It is memory-hard, so GPU guessing gains little; the salt is
  fresh per save and the passphrase never leaves the device.
- **History sharing.** MLS forward secrecy means a late joiner cannot read old
  ciphertext, so an existing device seals the channel's history key to the
  newcomer's X25519 public key; archives are encrypted under that key. The
  server only relays opaque envelopes.
- **Push stays content-free.** Wake payloads carry only opaque ids; the app
  decrypts and rewrites the notification locally, exactly as `plan.md` requires.

## Verified locally (Windows)

- `bun run test` — **433 tests pass** across 9 suites: convex **150** (+16),
  crypto **56** (+19), mobile **26** (+7), web 50, core 115, plus ui/tokens/
  avatars. New coverage includes the relay contract (8 `node:test` cases),
  verification approval rules, backup/history storage and mobile flows.
- `bun run typecheck` — 9/9 tasks; `bun run lint` — 11/11.
- `node --test "test/**/*.test.mjs"` in `infra/push-relay` — 8/8, including a
  verifiable ES256 APNs JWT and a fake-provider routing test, with no network.

## Not verified locally (needs devices / credentials)

- Real APNs/FCM/UnifiedPush delivery, and APNs token-auth against Apple; the
  relay's HTTP/2 client and provider credentials are untested against live
  endpoints.
- The iOS Notification Service Extension / Android data-message handler that
  decrypts a wake and rewrites the notification locally.
- Camera QR **scanning** and the on-device approval/restore UI.
- Mobile history import and push receipt, because the OpenMLS native engine
  (`packages/crypto/src/native-engine.ts`) is still a documented boundary.

## Operator setup

Set `PUSH_RELAY_URL` and `PUSH_RELAY_TOKEN` in the **Convex deployment**
environment (like `VAPID_*`), then run the relay with
`docker compose --profile push-relay up -d --build` and set its `PUSH_RELAY_TOKEN`
plus any `APNS_*`/`FCM_*`/`UNIFIEDPUSH_ENABLED` values in `infra/docker/.env`.
Unset, mobile push no-ops and sends never fail.

## Next: Phase 6

Admin panel, backups, license-key check, docs site and a one-command installer;
gate is an outside tester self-hosting without help.
