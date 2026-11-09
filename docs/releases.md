# Releases and client compatibility

Aulora clients and the self-hosted server are versioned separately. A client
does **not** need to be on exactly the same version as the server. Older desktop,
mobile and web clients remain supported until a release explicitly declares a
breaking change and raises the minimum compatible client version.

The one version that must match exactly is the discovery **API contract**
version (`API_VERSION`, currently `1`). It describes the well-known document
and public config shape, not the application release. A client refuses a server
whose `apiVersion` it does not support; see
[`ConnectScreen.tsx`](../apps/web/src/components/ConnectScreen.tsx). Changing
that contract is a breaking change for every supported client.

## How compatibility is advertised

- `server.publicConfig.version` reports the running server version.
- `server.publicConfig.clientVersion` carries two optional settings read from
  the deployment environment by
  [`getClientVersionPolicy`](../packages/convex/convex/lib/env.ts):

  | Variable | Effect | Default |
  | --- | --- | --- |
  | `AULORA_MIN_CLIENT_VERSION` | Clients older than this show an update-required screen and cannot enter the workspace. | unset (no gate) |
  | `AULORA_RECOMMENDED_CLIENT_VERSION` | Older clients still work but see a dismissible update notice. | unset (no notice) |

  Both accept a full stable SemVer such as `1.4.0`. An invalid value is ignored.
  The client compares them with the version injected from its own manifest at
  build time ([`client-version.ts`](../packages/core/src/client-version.ts)).
  Desktop starts the signed updater, web reloads for the newest bundle, and
  mobile links to its store listing.

- `server.publicConfig.features` advertises operator kill switches stored in
  `server.settings` (see [releasing.md](releasing.md#kill-switches)). They let a
  release disable a new code path without shipping a client. They are product
  guards, not authorization.

There is no separate changelog file. GitHub Releases are the changelog:
automatic releases use GitHub-generated notes from merged pull request titles,
and a manual run can supply full notes. Conventional Commit titles are therefore
the release-note input.

## Marking a breaking change

A release is breaking when an older supported client cannot safely keep using
the new backend. Examples: removing or renaming a public function, argument or
response field; adding a required field or argument; changing stored data so an
old client writes an invalid shape; changing authentication or discovery in a
way old clients cannot follow; or changing `API_VERSION`.

There is **no automatic "breaking" marker** in the updater code. The release
author declares the change through all of the following:

1. **Commit and pull request title.** Use a Conventional Commit breaking marker,
   such as `feat(api)!: remove the legacy upload argument`, and explain the
   migration in the pull request body. Conventional Commits also allow a
   `BREAKING CHANGE:` footer. GitHub-generated release notes include the pull
   request title, so the `!` stays visible in the published notes.
2. **Release notes.** For a manual release, pass a `Breaking changes` section
   through the Release workflow's `notes` input. State what breaks, the minimum
   client version, and any operator migration steps.
3. **Minimum client version.** Set `AULORA_MIN_CLIENT_VERSION` on the deployment
   (or in the instance admin Environment section) to the first client that
   supports the new backend. Raise `AULORA_RECOMMENDED_CLIENT_VERSION` first so
   users can update before the gate becomes mandatory.
4. **Schema compatibility gate.** Add synthetic fixtures for every supported
   older release, keep the snapshot current, and never remove or require a field
   without a completed backfill and the documented marker. See
   [Convex performance and upgrades](convex/README.md#evolve-schemas-and-apis-across-versions)
   and the release checklist's schema gate.

Bump `API_VERSION` only when the discovery/public-config contract itself must
change incompatibly. Clients reject a mismatch outright, so this is a hard gate
that strands any client that cannot update.

## First-run owner and multiple owners

A fresh instance no longer seeds the owner from Docker environment defaults. The
app claims it with a one-time setup token printed by the setup container; the
`OWNER_EMAIL` / `OWNER_PASSWORD` environment path and an explicit `SETUP_TOKEN`
override remain supported for automation and existing deployments. Public
sign-up is denied while no server/owner exists, so an outsider cannot
pre-register the operator's address; the setup claim bypasses that policy
explicitly. Instances that already have an owner never see the setup screen.

Multiple owners are stored additively in the optional `server.ownerIds` array.
The required legacy `server.ownerId` stays populated with one of the owners, and
the server treats a missing `ownerIds` as `[ownerId]`, so an older client or a
database restored from an older release keeps working. This is a compatible
expansion, not a breaking change; no backfill is required before the new
backend runs. `setup` runs an idempotent `ensureOwnerIds` migration to complete
the stored shape on older workspaces.

If the setup action dies between creating the credential and finalizing the
claim, the operator's retry reports that the email already exists. On an
uninitialized instance the setup path recovers that orphan only by signing in
with the password the operator supplied: a matching password reuses the account
as the new owner, while a different password leaves the existing account
untouched and the claim fails. It never deletes a pre-existing account, so an
uninitialized instance cannot be taken over with a different password. Setup
attempt counters keep verified tokens in a namespace separate from
invalid-attempt buckets, so junk guesses that collide with the operator's bucket
cannot lock the real token out.

An interrupted account deletion can leave an owner id whose Better Auth user is
gone. The last-owner guard treats such a ghost as not live and fails closed, so
it cannot be used to remove the only real owner. The hourly recovery prune
completes the idempotent cleanup when another live owner exists; otherwise it
keeps the reservation and writes an `owner.deletion.orphaned` audit row for the
operator. Expired reservations are never simply dropped.

Time passing is not treated as proof that a pending deletion failed: Better Auth
removes its own user row in a separate transaction after the reservation is
written. A reservation therefore keeps its place until the recovery prune has
confirmed the auth user is still present after a one-hour grace period
(`OWNER_DELETION_RESERVATION_GRACE_MS`), which is longer than any request or
action lifetime. A retried deletion refreshes `reservedAt` instead of losing its
place. The prune also checks the stored `server.ownerIds` themselves for ghosts
that have no reservation (an interrupted upgrade or an older release), healing
one only while another live owner remains and otherwise flagging it. The
`owner.deletion.orphaned` audit row is recorded once per state transition
(persisted in `server.ownerDeletionAlerts`), so the hourly prune does not append
another row on every run.

The local password minimum (`AUTH_MIN_PASSWORD_LENGTH`) is exposed only through
the live `server.publicConfig` query, not the `/.well-known/aulora.json`
discovery document. That document's strict key set is part of the discovery
contract older clients validate, so adding `auth.local.minPasswordLength` there
would strand a 1.4.0 client after a server upgrade. The setup container's
generator (`infra/docker/setup/well-known.mjs`) therefore allowlists every
discovery field to the previous release's contract instead of copying the live
public config. New public-config fields stay additive and must not reach the
static document until a release raises the strict contract.

## Native and desktop OAuth handoff

Provider sign-in for the desktop and mobile clients finishes through
`/api/auth/native/start`, `/finish` and `/exchange`. The handoff code is now an
opaque random value stored only as a SHA-256 digest. It is single-use, expires
after two minutes, and is sealed at rest with the workspace encryption key.
For client-started flows the client sends a PKCE-style verifier with the
exchange, and that verifier never leaves the install that started the flow; a
remote attacker who did not initiate the flow cannot complete a sign-in. A
malicious app on the same device that claims the `aulora://` scheme is outside
this protection: verified app links (Android) and universal links (iOS) are the
robust fix. A callback with no matching pending transaction, for another
workspace, or after the local TTL is rejected. The start, finish and exchange
routes rate-limit by the proxy-derived client address
(`X-Real-IP`, or the last `X-Forwarded-For` hop; see the
[proxy contract](../infra/docker/proxy/README.md)), hash that address into a
bounded bucket set, and apply a shared per-action ceiling, so a spoofed or
distributed flood cannot grow storage without bound or turn the routes into
repeated provider or database work. A request that the per-address bucket
already refuses does not spend the shared ceiling, and a request that presents a
live start transaction or a redeemable code skips it, so one flooded address
cannot lock everyone else out of signing in. A signature-valid transaction
cookie can outlive its row, so it is not by itself proof of a live transaction:
the shared ceiling applies unless the exact transaction row is still live.
Finish also limits per session, and each live transaction records its own finish
counter: 5 attempts per minute, updated on that transaction row, so a caller
who covers the shared hash buckets with precomputed transaction ids cannot spend
another flow's allowance.
Error redirects carry both `error` and `server` (the workspace origin), and an
untrusted `return` sends the browser to the workspace's own error page instead
of raw JSON.

**Desktop and mobile provider sign-in requires both the client and the server on
this release.** Older clients lack the `tx`/`challenge` binding, and a new client
calling an older server gets `404` from `/api/auth/native/start`. Operators must
upgrade the server first, then recommend the new client, and only after that
raise `AULORA_MIN_CLIENT_VERSION`. Local email/password sign-in and existing
sessions are unaffected.

Clients also mint a random `tx` (at least 128 bits, URL-safe) per sign-in and
pass it to `/api/auth/native/start` with the challenge. The server stores a
short-lived (ten-minute) start transaction keyed by the digest of `tx` and sets
a signed, HttpOnly, `SameSite=Lax` cookie scoped to `/api/auth/native`. Each
transaction gets its own cookie name (`aulora_native_auth_tx_<digest prefix>`,
with a `Max-Age` 30 seconds longer than the server transaction lifetime), so two
sign-ins started in one browser coexist instead of overwriting each other; a
mismatch never clears any cookie; only the transaction named by the request is
ever expired, after a successful mint, after a finish that consumed its
transaction, or when its row has expired. `native/finish` requires that cookie, verifies
that the supplied
`challenge`, `return` and `tx` equal the stored transaction, and consumes it in
the same mutation that mints the code. Without a matching transaction cookie,
finish mints nothing and redirects to the workspace error page. That binding
matters because `SameSite=Lax` cookies are sent on a cross-site top-level
navigation: a crafted finish URL with an attacker's own challenge would
otherwise read the victim's ambient session and mint a code for it. The server
echoes `tx=<value>` on every redirect back, including success and error
redirects and a same-origin web return, and the client accepts a callback only
when it matches the pending transaction's `tx` and workspace. Matching the
public origin alone no longer authenticates a callback: a forged error or code
link is ignored without clearing the pending sign-in. The same rule applies to
an error delivered on the custom scheme: the desktop shell and mobile app store
it for the sign-in screen only when it names their pending transaction and
workspace. A client treats a callback with no `tx` as invalid for this flow, so
an older workspace that does not echo `tx` cannot finish native or desktop
provider sign-in. Those workspaces also do not serve
`/api/auth/native/start`, so the client update and the backend update must ship
together for provider sign-in; local email/password sign-in and existing
sessions are unaffected. The server and both clients share one ten-minute
transaction lifetime (`NATIVE_AUTH_TX_TTL_MS` in `@aulora/core`). A finish after
that lifetime redirects with the allowlisted `auth_expired` code, which the
clients show as "Sign-in took too long, please try again." The client writes its
pending record before the start request, so its local lifetime can lapse just
ahead of the server row; the transaction cookie therefore lives 30 seconds
longer than the row. If the local pending record is missing anyway (for example
cleared storage), a callback still shows that one message only when it is an
`auth_expired` redirect with a well-formed `tx` that names the workspace the app
is currently using. No other error or code is accepted without a pending record,
and that display-only case neither completes a sign-in nor clears anything.

A custom-scheme (`aulora://`) return is bound to the start transaction and the
PKCE verifier, but any app on the device can claim that scheme. A malicious app
that receives the callback is outside this protection, even though it still
cannot exchange the code without the verifier for a client-started flow. Treat a
compromised device as compromised: the binding prevents a remote attacker who
did not initiate the flow from completing it, not local malware from observing
the callback. Verified app links (Android) and universal links (iOS) are the
robust fix.

Deep links are no longer allowed to carry a session cookie. Older mobile builds
that accepted `aulora://auth/callback?cookie=…` (or the fallback launch-URL
cookie) must update before provider sign-in works against this backend. There is
no link-driven cookie fallback in the current client. When rolling this out to a
mixed fleet, treat the client update as required for provider sign-in and raise
`AULORA_MIN_CLIENT_VERSION` after the recommended-version notice has run. Local
email/password sign-in and existing sessions are unaffected.

The new `nativeAuthHandoffs` and `nativeAuthTransactions` tables are additive.
Handoff rows are deleted when exchanged and start transactions when consumed or
after ten minutes; both are swept in bounded batches by a cron through the
`by_expires` index. An upgrade needs no backfill, and older rows from before the
feature do not exist.

## Solo-call timeout

The backend now disconnects a person who has been alone in a voice channel or
conversation call for the workspace's solo-call timeout (five minutes by
default, `AULORA_CALL_ALONE_TIMEOUT_SECONDS`, overridable at runtime). This is a
compatible expansion:

- `calls` gains the optional `aloneSince`, `aloneDeadline`, `aloneJobId` and
  `endedReason` fields, and the call queries gain optional `aloneDeadline`,
  `aloneTimeoutSeconds` and `endedReason` response fields. `aloneJobId` tracks
  the single pending enforcement job so re-arming cancels the previous one.
  Older clients ignore them; older stored calls simply have none.
- `calls.stay` is a new mutation used by the **Stay** button. Clients from
  before the feature never call it and lose nothing.
- An existing solo call needs no backfill: the 30-second call sweep arms it the
  first time it runs, and a call that has already exceeded the window ends on
  that pass. Newly solo calls are armed immediately by the mutation that removed
  the second-to-last participant.

Older clients are still disconnected by the server. Enforcement deletes the
solo participant's seat and ends the call; every client already treats a call it
is no longer part of, or one that ends, as a reason to tear down its media and
leave. Older clients just do not show the explanatory notice or the last-minute
**Stay** hint, which are additive UI.

No minimum client version change is required. LiveKit rooms are not touched:
the repo mints room tokens but has no media-server admin API, so a disconnected
device closes its own room connection when the roster change tears the call
down.

## Release-author checklist for a breaking change

1. Prefer a compatible expansion: add optional fields or a versioned API, deploy
   readers that accept both shapes, and keep existing names and response shapes
   for supported clients.
2. Backfill stored data in bounded, resumable batches and verify completion
   before tightening validators.
3. Ship and verify the new client against the new backend before enforcing a
   minimum.
4. Publish the breaking change in the release notes, then raise
   `AULORA_RECOMMENDED_CLIENT_VERSION` and finally
   `AULORA_MIN_CLIENT_VERSION`.
5. Test the oldest supported client against the new backend, plus a new client
   during the rollout window where the old backend may still be serving.
6. Keep the minimum in place while the incompatible backend runs. Lower it only
   with a compatible backend, and never set it above the oldest client the
   release notes still support.

The broader publication process, deploy order, rollback limits and upgrade
evidence are in [Preparing and publishing a release](releasing.md).
