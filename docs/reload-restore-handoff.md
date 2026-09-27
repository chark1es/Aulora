> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Handoff: fix Aulora MLS group restore after page reload

Work in `/Users/chark1es/Stuff/Github/Aulora` (Bun + Turborepo monorepo). You are continuing a
debugging session that is 80% done. A regression test in crypto already passes; the real-app
reload path still fails. Do NOT start new features.

## Goal of the current thread
Aulora (self-hosted E2EE team chat, Convex backend) loses all channel names/messages after a
page reload. Root cause found: `packages/crypto/src/web-engine.ts` wrote group state to the
IndexedDB keystore (`aulora/mls/group/<hex groupId>`) but never read it back. A fix is partially
implemented and partially verified.

## What is already done (all committed to working tree, tests green)
- `MlsEngine.loadGroup(groupId)` added to the interface and implemented in:
  - `web-engine.ts` (reads keystore, `decodeGroupState`, `activate()`)
  - `worker-engine.ts` + `worker-protocol.ts` (new op `loadGroup`, new result kind `boolean`)
  - `native-engine.ts` (bridge passthrough; mock in `test/native-engine.test.ts` updated)
  - memory engine in `packages/core/src/chat/testing.ts` (now persists per groupId in a shared store)
- `packages/core/src/chat/session.ts`:
  - new `restoreLocalGroup()` called at the top of `bootstrapChannel()` — attempts
    `engine.loadGroup(decodeMlsBytes(channel.mlsGroupId ?? encodeMlsBytes(channelGroupId(id))))`
  - new `hydrateChannelNames()` + `channelNameFor()` on the session
- `apps/web/src/providers/ChatProvider.tsx`: effect that opens every channel and hydrates names
- `apps/web` UI work from earlier sessions is done and green: workspace menu (rail hidden for
  single workspace), create/rename channel modals, context menus, private channels, settings
  redesign, animations, flat composer, hover toolbar anchoring.
- Backend was redeployed to the self-hosted Convex (private channels + addMember/removeMember).
- Tests: crypto 66, core 153, web 90, convex 184, ui-web 16 — all passing. typecheck+lint clean.

## The remaining bug (current debugging state)
After reload, `loadGroup` returns `true` for ONE group and `false` for all others. Proven via
temporary `console.debug` logs already in `session.ts` ("[aulora] bootstrap", "[aulora] restore").

Hypothesis to check first: the keystore key used by `persistActive()` is
`GROUP_PREFIX + bytesToHex(state.groupContext.groupId)`. Verify that ts-mls `createGroup(groupId, ...)`
stores `state.groupContext.groupId` as the exact bytes passed (`channelGroupId(channelId)` = utf8 of
`aulora:channel:<id>`), and that `bytesToHex` of the restored-context id matches. If ts-mls derives or
transforms the id (e.g. hashing), compute the key from the group context when
persisting instead of trusting the input bytes.

How to debug:
1. `cd apps/web && bun run dev` (vite on 5173; the .env.local and vite proxy are already configured
   for the tunnelled test server — see below).
2. Use Playwright persistent context (chromium installed): scripts exist at
   `/tmp/reload-test2.ts` (create channel -> reload -> titles become "channel"),
   `/tmp/debug-restore.ts` (prints the aulora debug logs). Run with `bun run /tmp/<script>.ts`.
3. Inside a Playwright page, dump IndexedDB keys: open db `aulora-crypto` (stores include a value
   store; `indexedDbKeyStore()` in `packages/crypto/src/indexeddb.ts` names them), list keys, compare
   with expected `aulora/mls/group/` + hex of utf8 "aulora:channel:<channelId>".
4. Watch for a write-race: `persistActive()` is called in `activate()` during create/join; confirm
   with two channels created in the same profile that BOTH keys exist in IndexedDB (one survived in
   the last run, the other did not).

After fixing, REMOVE the two temporary `console.debug` lines in `packages/core/src/chat/session.ts`
("[aulora] bootstrap" in bootstrapChannel, "[aulora] restore..." in restoreLocalGroup).

## Verification to run when fixed
- `bun run /tmp/reload-test2.ts` must print: BEFORE title "reload-two", AFTER title "reload-two",
  message visible: true.
- Then reseed the workspace with ONE persistent profile
  (`/tmp/full-reseed.ts` and `/tmp/reseed2.ts` exist; they drive the real UI through chromium
  `launchPersistentContext("/tmp/aulora-seed-profile")`, which is what makes all channel groups
  belong to one device so names decrypt). 11 old orphaned channels are already archived.
- Full suite: tokens/ui-web/core/convex/web tests + typecheck + lint (turbo: `bun run test` at root).

## Environment (test server behind reverse SSH tunnel from the user's Windows box)
- App origin `http://localhost:8080` (nginx), Convex API `http://localhost:3210`. Both live in
  processes owned by the SSH session — do not kill sshd.
- Test owner: `owner@aulora.test` / `Aulora-Test-Password-123`; 7 dummy accounts
  `<name>@aulora.test` with the same password (tudor-style names: ludmil, kathryn, jacob, savannah,
  marvin, wade, theresa). Roles Admin/Moderator/Member exist; 2 categories; channels seeded.
- Owner JWT for the Convex HTTP API: refresh with
  `curl -X POST http://localhost:8080/api/auth/sign-in/email -H 'Content-Type: application/json'
  -H 'Origin: http://localhost:8080' -d '{"email":"owner@aulora.test","password":"..."}' -D /tmp/h.txt`
  then extract the `better-auth.convex_jwt` cookie (URL-decoded) from /tmp/aulora-headers.txt and
  store in /tmp/aulora-jwt.txt. Convex HTTP API: POST /api/query or /api/mutation with
  `{"path":"roles:list","args":{},"format":"json"}` and Bearer JWT; int64 args must be encoded as
  `{"$integer": "<base64 of 8-byte little-endian>"}`.
- Convex admin key: ask the user for it (it was pasted in chat, not stored here); deploy with
  `cd packages/convex && CONVEX_SELF_HOSTED_URL=http://localhost:3210
  CONVEX_SELF_HOSTED_ADMIN_KEY='<key>' bunx convex deploy --yes`. `docs/deploy-test-server.md`
  documents this.
- The t3 browser-automation panel is broken ("No preview automation host"); use Playwright scripts
  instead (chromium is installed via `bunx playwright install chromium`).

## House rules
- Never commit unless asked. Keep `bun run format` / biome clean; `biome check` gates lint.
- Update tests when changing behavior deliberately (as done for tokens palette + channel tests).
- Do not commit unless explicitly asked.

## Suggested skills
- `diagnosing-bugs` for the persistence hunt (it is a hard bug with an evidence loop).
- `apple-design` if any further UI polish is requested (the app now follows that review).
