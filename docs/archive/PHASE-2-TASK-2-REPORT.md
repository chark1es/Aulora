> Archived work record. This file can describe removed code or unresolved work that has since changed. Use [the current documentation](../README.md) and [project status](../project-status.md).

> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phase 2, Task 2 — Core chat backend: evidence

Date: 2026-09-26. Scope: `packages/convex` only. Apps and infra untouched.

## What was verified

- Root `bun run typecheck` (7/7), `bun run lint` (8/8) and `bun run test` (7/7)
  pass. `@aulora/convex` runs 72 tests across 12 files.
- New functions deployed to the **running self-hosted stack**
  (`aulora-convex-backend-1`, Convex revision `0cf49cbf`) with
  `bunx convex deploy --yes`.
- Live flow below is a real transcript from that deployment: sign in as the
  workspace owner over the web `/api/auth` proxy, then create a channel, send a
  ciphertext message, list it, toggle a reaction, and append an MLS commit.

## Live transcript (ids shortened)

```
== sign-in ==
{ "status": 200, "jwtPresent": true, "jwtIsOpaqueToThisScript": true }

== channels.create ==
{ "channelId": "jd7b8fa1mwme1qkq2edxgy5f918f4kgy" }

== messages.send ==
{ "messageId": "k973tsgk394w7bp8wrjhfp74658f52vk" }

== messages.list ==
{ "isDone": true, "page": [ {
    "authorId": "k17a5v5ztmbm6nn67swk2e4vd18f5gzf",
    "ciphertext": "aGVsbG8gZnJvbSB0aGUgbGl2ZSBzdGFjaw==",
    "deletedAt": null, "editedAt": null, "epoch": 0,
    "mentionUserIds": [], "pinnedAt": null, "threadRootId": null } ] }

== reactions.list ==
[ { "emojiCiphertext": "dGh1bWJzLXVw", "userId": "k17a5v…" } ]

== mls.listCommits ==
[ { "commitCiphertext": "bWxzLWNvbW1pdA==", "epoch": 1,
    "welcomeCiphertext": "bWxzLXdlbGNvbWU=" } ]

== mls.currentEpoch ==
1

== unauthenticated channels.list ==
{ "rejected": true, "message": "ConvexError: … Uncaught ConvexError: Not authenticated" }
```

`aGVsbG8gZnJvbSB0aGUgbGl2ZSBzdGFjaw==` is base64 of the plaintext the client
would encrypt; the server stores it verbatim and never parses it. The
unauthenticated call is the auth gate firing.

## Notes / not verified live

- `convex-test` does not execute `crons.ts`; `presence.sweepStale` and
  `typing.purgeExpired` are tested by calling the internal mutations directly.
- `files.generateUploadUrl` returns a real URL in the live stack, but the
  browser upload round-trip (POST the encrypted blob, then `files.record`) is
  exercised only in `convex-test` via `ctx.storage.store`.
- `join`/`leave` return the required MLS action (`add`/`remove`) and record
  membership in `channelMembers`; the server cannot build a commit, so the
  client publishes it through `mls.appendCommit`. This was not driven by two
  real MLS clients.
