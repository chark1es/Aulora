> Archived work record. This file can describe removed code or unresolved work that has since changed. Use [the current documentation](../README.md) and [project status](../project-status.md).

> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phase 2 — Core chat, encrypted from day one: Gate Report

Date: 2026-09-26. Gate: **a team can use web daily and the database holds only ciphertext.**

**Verdict: PASS** — independently reproduced on a fresh `docker compose up` (zero channels),
with the full Playwright suite green from an empty workspace and a direct database check
proving no plaintext at rest.

## What shipped

- **`packages/crypto`** — `MlsEngine` interface and a `ts-mls@1.6.4` web engine (pinned
  `@noble/hashes`/`@noble/curves`), an encrypted `KeyStore` (IndexedDB, non-extractable keys),
  a Web Worker wrapper with a direct fallback, and per-file AES-GCM attachment envelopes +
  blurhash. `MOBILE.md` records the OpenMLS-on-device plan. 11 tests.
- **`packages/core`** — a Convex-agnostic MLS chat session + hooks: device registration and
  KeyPackage publishing, channel group bootstrap, **auto-approve of join intents (works at
  epoch 0)**, per-channel encryption/decryption, membership rekey, plus encrypted attachment
  flow, a local IndexedDB search index, and an offline outbox.
- **`packages/convex`** — Phase 2 core-chat backend: channels (create/list/rename/topic/archive/
  join/leave/DM/group-DM), messages (send/list/thread/edit/soft-delete/pin), reactions, read
  states with mention counting, typing, presence + crons, encrypted files with size cap and
  rate limits, and the MLS relay (`keyPackages`, `mlsCommits`, join intents). 78 tests.
- **`apps/web`** — channel sidebar with categories and unread badges, realtime decrypted
  message list, composer with mention autocomplete, threads, reactions, edits/deletes/pins,
  presence + member list, read cursor and "jump to first unread", encrypted uploads with
  thumbnails + EXIF stripping + lightbox, local search (Cmd/Ctrl+K), and the offline outbox
  with a reconnecting indicator.

## Gate evidence (independent fresh run)

- `docker compose down -v` → fresh `.env` → `up -d --build` → `setup` exited 0 (owner created).
  Pre-suite DB counts: `channels=0`, `messages=0`, `files=0`.
- **Full Playwright suite from zero state, no seeding: `3 passed`** — sign-in, **two-device
  encrypted chat**, and attachments/search/offline-outbox.
- **Ciphertext at rest:** sent `CANARY-<random>` and uploaded a uniquely named image; device B
  decrypted both, yet
  `SELECT count(*) FROM documents WHERE convert_from(json_value,'UTF8') ILIKE '%CANARY…%'` → **0**
  (same for the filename). Message rows hold an opaque `ciphertext`; `files` rows hold only
  `storageId`/`sizeBytes`/`uploaderId`. No canary in container logs. `mentionUserIds` stays
  plaintext by design while the mention text does not.
- `turbo run typecheck lint test --force` → **22/22** successful on a genuine re-run.

## Decisions recorded

1. **Per-file AES-GCM key+IV travel inside the MLS-encrypted message payload**, so the server
   never sees a file key or any plaintext metadata.
2. **Join auto-approve must run at epoch 0**: the creator's group is at epoch 0 until it adds
   someone, so a guard that skipped epoch 0 was removed.
3. **Channel name is re-encrypted at the new epoch on membership change** (a later joiner cannot
   read pre-join ciphertext under MLS forward secrecy).
4. **Search is local-only** (IndexedDB inverted index over decrypted text); no text leaves the device.
5. **Outbox is optimistic + IndexedDB-persisted**, flushed on reconnect with backoff.

## Known caveats / deferred

- Background backfill of **older** history into the search index is implemented but exercised
  only for the current session.
- No canvas in Node, so **EXIF stripping and thumbnail generation are covered by the live-browser
  e2e**, not unit tests; the pure helpers are unit-tested.
- Crons (presence sweep, typing purge) are tested by calling the internal mutations directly,
  not by waiting on the scheduler; live typing/presence are not yet in an e2e.
- The **mobile MLS engine** (OpenMLS) is still planned, not built — Phase 4.
- macOS/iOS testing needs a reachable host; `charles-macbook-air` did not resolve from the build
  environment (see Phase 4).

## Next: Phase 3

Role editor, bitfield enforcement in every mutation, category and channel overrides, audit log
and invites; gate is a permission test suite over the resolution order and hierarchy.
