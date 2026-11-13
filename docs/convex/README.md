# Convex performance and upgrades

Read this guide before changing backend data access, client subscriptions,
schemas, migrations, Convex versions, or server deployment scripts. It defines
review requirements for those changes; it does not claim the current updater
implements every safeguard below.

Aulora runs one workspace per server. Its self-hosted Convex backend uses
Postgres for persistence. Application functions and schemas are deployed to that
local backend by the setup container, not to Convex Cloud. Treat the frontend,
backend functions, stored data, and Convex engine as separately versioned parts
of an upgrade.

## Keep reads and subscriptions bounded

- Select records with an index scoped to the channel, user, thread, or other
  requested resource. Filtering after reading a whole table still incurs that
  read work. Review index field order against the actual query.
- Paginate growing histories and lists. Give live queries an explicit bounded
  window and a way to fetch older results. A fixed cap must not silently hide
  records that the feature promises to return.
- Bound nested lookups as well as the first query. Batch reactions, files, and
  membership lookups for the visible page instead of loading them for an entire
  channel history.
- Subscribe to the data a view needs. Scope presence to visible members and
  release subscriptions when the view or server changes. Check how one write
  affects every subscribed client, not just the cost of the write itself.
- Keep high-frequency typing and presence writes away from shared workspace
  records. A shared counter or record touched by every message can cause
  transaction conflicts and invalidate unrelated subscriptions.
- Keep authorization checks on every public operation. Performance changes must
  preserve private-channel access, role checks, bans, and permission changes for
  already-connected clients.
- Measure before adding Redis or another service. Record dataset size, connected
  clients, message and heartbeat rates, latency, transaction retries, CPU, and
  memory on representative self-hosting hardware. Identify the query or write
  responsible before changing the architecture.

CI enforces the first two points with `bun run perf:convex`
([performance guards](../performance.md)): new `.collect()` calls, `.filter()`
without `.withIndex()`, and dynamic `.paginate()` windows are rejected. Fix the
query rather than adding an allowlist entry, and remove an entry when its read
becomes bounded.

For affected paths, test both a large history and concurrent activity in a busy
channel. Include the number and size of records read, subscription update
volume, and any remaining limits in the PR. Avoid presenting a test with a few
messages as evidence that the path scales.

### Retained surface subscriptions

The web chat shell and the mobile hub keep recently used surfaces mounted so a
revisit does not re-run its queries. Retention is MRU-bounded and also
time-bounded: at most two retained view surfaces on web (Notes, Boards,
Scheduled calls and Transcripts) and three hub tabs on mobile stay mounted, and
a hidden surface is unmounted after 60 seconds without navigation. Unmounting
releases that surface's Convex subscriptions and any pages it had loaded.

The web chat canvas is outside that retained-view set: it remains mounted as the
single open-conversation window even while settings or admin cover it, so its
one channel subscription continues while hidden. The Threads inbox query is
gated to the selected main view and skips when Threads is not on screen. On
mobile the retained set is the hub tabs, while the Threads inbox query follows
the retained tab and therefore skips once Threads is evicted or expires. A
hidden Notes surface is held past the lifetime only while an unsaved editor
draft would otherwise be deleted; unrelated hidden surfaces on both clients
still expire, and an active Notes surface is retained because it is active.

This records a source-visible subscription policy, not a measured result. No
busy-channel or busy-workspace load, latency, CPU or subscription-update
measurement was run for these retained surfaces.

## Session and access-token lifecycle

Convex authenticates every request with a short-lived JWT that the Better Auth
`convex` plugin mints (`packages/convex/convex/auth.ts`). With no
`jwt.expirationSeconds` override the plugin's default is **15 minutes**, and the
client refreshes it shortly before it expires. That rotation is routine and must
never unmount the signed-in tree; treat it as part of normal operation when
changing session code.

- Create every `ConvexReactClient` with `CONVEX_AUTH_CLIENT_OPTIONS` from
  `@aulora/core`. It refreshes 60 seconds before expiry
  (`authRefreshTokenLeewaySeconds`) instead of the 10-second default, so a
  throttled or briefly offline tab still rotates in time, and it reuses the
  token the socket already confirmed (`initialAuthTokenReuse`) instead of
  re-authenticating every query for a second identity on each page load.
- Hand `ConvexBetterAuthProvider` the client from `createProviderAuth(...)`, not
  the raw Better Auth client. Convex reads a `null` token as "signed out"; the
  wrapper keeps the last issued token when `/api/auth/convex/token` cannot be
  reached and only reports `null` when the auth server answers `401`. Without
  it, a single failed refresh makes `useConvexAuth()` report
  `isAuthenticated: false`, and the session gate rebuilds the whole client pair,
  which looks like an app reload.
- `useConvexAuth().isRefreshing` means the server rejected the current token and
  the socket is paused while a replacement is fetched; `isAuthenticated` stays
  `true`. Do not unmount on that state.
- Long-lived WebSockets must be allowed to idle. The shipped web container sets
  `proxy_read_timeout`/`proxy_send_timeout` to 3600s on `/api/`; an edge proxy in
  front of it (Coolify's Traefik, Cloudflare, a tunnel) must not enforce a
  shorter WebSocket idle timeout. Convex sends periodic pings, so a much shorter
  edge timeout shows up as a reconnect every N minutes.

When diagnosing a reported "the app refreshes every few minutes", enable
`localStorage.setItem("aulora.debug.remount", "1")` in the browser. It logs:

- each document boot with its `PerformanceNavigationTiming.type` (`navigate`,
  `reload`, `back_forward`) and a session-scoped boot count, so a real page
  reload is distinguishable from a React remount;
- the mount and unmount of `ProfileSession`, `SessionGate`, `MembershipGate` and
  `ChatSessionShell`;
- every Convex auth state change (`isAuthenticated`, `isLoading`,
  `isRefreshing`);
- every Convex connection state change (`connectionCount`,
  `connectionRetries`, connected), where a count that grows on a fixed cadence
  points at a websocket idle timeout in front of the backend.

Every line carries an ISO timestamp. Turn it off by removing the key.

## Evolve schemas and APIs across versions

Existing installations contain old records, and desktop or mobile clients can
remain on older versions after a server upgrade. A release must also support
the documented upgrade path when operators skip intermediate releases.

1. Expand the schema with optional fields or validators that accept both old
   and new representations. Deploy readers that understand both and writers
   that produce the new representation. Keep existing API names, arguments, and
   response shapes compatible with supported clients, or add a versioned API.
2. Backfill existing records in bounded, resumable batches. Make retries safe,
   record progress, handle concurrent writes, and verify completion. Include
   all required migration steps when upgrading from each supported older
   release, rather than assuming every intermediate release was installed.
3. Tighten validators or retire legacy fields and APIs only after the backfill
   and supported-client compatibility checks pass. Publish any minimum client
   version and enforce it before making an incompatible change.

Record stored-shape compatibility with synthetic fixtures in
`packages/convex/test/fixtures/compat/v<release>/*.json`. The
`packages/convex/test/compat/schema-compat.test.ts` test inserts them through
the current validators, and `scripts/ci/schema-snapshot.json` plus
`scripts/ci/check-schema-compat.mjs` (run by `release:check`) fails when a field
becomes required, a required field is added, or a table/field is removed. An
intentional tightening is allowed only with a marker comment in `schema.ts`:

```
// @compat-allow-tighten: server.exampleField -- backfilled by migration X
```

Only add the marker after the backfill has completed for every supported
upgrade path and supported old clients are no longer expected to write the old
shape. Regenerate the snapshot with
`node scripts/ci/check-schema-compat.mjs --update` and review the diff.

Convex validates existing documents when a schema changes; incompatible records
can reject a deployment. Schema deployment does not fill in missing values.
New indexes can also require a backfill, so measure deployment time with a
realistic dataset. Check the pinned SDK and engine before using staged-index or
staged-validator features described in newer upstream documentation.

Preserve encryption envelopes, key versions, and access checks during backfills.
Changing databases or adding an index does not make encrypted message bodies
searchable. Any separate search index needs an explicit content-protection and
permission model, plus edit and deletion handling.

## Deploy a release in a safe order

The target sequence is:

1. Verify a restorable backup of data and uploads, with the encryption key and
   deployment configuration preserved separately and securely. Record the old
   source revision and image versions.
2. Build the frontend and setup images from the same release. Reusing an old
   setup image can redeploy old functions even when the frontend is new.
3. If the release changes the Convex engine, follow its tested engine-upgrade
   sequence. Explicitly recreate the engine service when needed and verify the
   running version. Keep the setup image's key-generation binary compatible
   with that engine. Deploying functions alone does not upgrade the engine.
4. Deploy the backward-compatible backend and run required migrations. Treat a
   failed required migration as an upgrade failure. Verify the expected APIs
   and behavior, not only the presence of a module name.
5. Publish the new frontend and restart dependent services only after backend
   verification succeeds. Check discovery, sign-in, history, uploads,
   permissions, subscriptions, and reconnection from a supported older client.
6. Mark the release installed only after its verification succeeds. On failure,
   report which steps completed and retain enough state for a safe retry.

Current gaps to account for when changing the updater:

- The frontend/backend deploy-order gap is fixed:
  [deploy.sh](../../infra/docker/deploy.sh) and the
  [staged updater](../../infra/docker/update/stage.mjs) now run `setup` before
  recreating the web container. A failed backend deploy leaves the previous web
  build serving, so the release schema must accept both that old frontend and
  the new one.
- Those paths compare the target engine image ID with the existing container
  and recreate it when changed, waiting up to 120 seconds for health before
  setup. They also wait for engine and web health before writing the installed
  stamp. These healthchecks do not verify application compatibility or storage
  upgrade safety; run the live upgrade/recovery checks below. Review Coolify
  engine upgrades separately as well.
- The [setup script](../../infra/docker/setup/entrypoint.sh) currently treats
  the voice-permission migration as best effort. Value-detected migrations must
  record a marker in `server.appliedMigrations` (as `restrictKanbanEditing`
  does) so a later owner re-grant survives the next deploy. Required future
  migrations need explicit failure handling and completion verification.
- A web-only rollback exists in `deploy.sh --rollback`: it restores the web
  image pinned by the previous deployment. It does not roll back functions,
  schemas, or the engine, so use a tested backup/restore for an irreversible
  migration.

Engine upgrades may have their own storage-format and downgrade constraints.
Redeploying old application code does not undo a data migration or guarantee
that an older engine can read upgraded storage. Choose a tested compatible
rollback or restore into an isolated stack. State how writes made after the
backup will be handled before replacing the live installation.

## Verification before release

For schema, migration, API, or updater changes, include evidence for each
applicable case in the PR and release notes:

- Fresh installation and an upgrade from populated supported older releases,
  including a skipped-version upgrade.
- Supported old clients against the new backend, and new clients against the
  backend version they can encounter during rollout.
- A failed deployment or interrupted migration followed by a safe retry;
  the UI and installed-version marker must not report false success.
- Large-table schema validation and index creation time, alongside the busy
  channel and subscription checks above.
- Engine recreation and running-version verification when its pin changes.
- Restore of history and uploads with the preserved encryption key, and a
  documented recovery path for irreversible changes.

Run the relevant repository checks from [CONTRIBUTING.md](../../CONTRIBUTING.md).
If a live upgrade or load test was not run, name that gap instead of implying
the release is verified. Operator steps belong in the public
[updates guide](../../apps/docs/content/updates.md); the
[release checklist](../releasing.md) covers the broader release process.

## Upstream references

- [Schema validation](https://docs.convex.dev/database/schemas)
- [Indexes](https://docs.convex.dev/database/reading-data/indexes)
- [Realtime query dependencies](https://docs.convex.dev/realtime)
- [Production deployment and client compatibility](https://docs.convex.dev/production/overview)
- [Self-hosted backend](https://github.com/convex/convex-backend/tree/main/self-hosted)

## Automatic chat compatibility backfills

The minute crons `member roles backfill` and `attachment scopes backfill` invoke
`maintenance.backfillMemberRoles` and `maintenance.backfillAttachmentScopes`.
Each invocation processes one page (up to 1000 members or 500 messages) and
atomically commits its cursor and counts in `migrationProgress`, indexed by
migration key. Intermediate ticks never patch the `server` singleton read by
`publicConfig`; only completion writes `server.memberRolesBackfilled` or
`server.attachmentScopesBackfilled`, once. Completed ticks read only the server
row. The optional server cursor fields remain accepted as a fallback, but no
released server wrote them. An interrupted older run without `migrationProgress`
restarts from the beginning; replaying processed rows is safe. A previously
scheduled `backfillMemberRoles({cursor})` job may fail argument validation once
because the mutation now accepts no arguments; the minute cron supersedes it.
No deploy/setup invocation is needed. Retries of the current backfill resume the
last committed page. Existing member writers maintain reverse
links while the role backfill runs.

Attachment repair skips deleted messages, missing files, board files, and already
scoped files. An unscoped file is shared only when its uploader is the legacy
message author; foreign-author references remain private and increment
`migrationProgress.skippedReferences`. The first eligible live reference scopes
the upload. New sends check ownership before binding unscoped files immediately.
Monitor completion markers and progress when verifying an upgrade.

The read-budget tests measure returned documents (including repeated point
reads): a fresh 1000-member page with one role per member reads 1001 documents
and writes 1000 reverse links plus progress; a 500-message page with ten file
references per message reads 5501 documents. Existing reverse links add their
row count to member-page reads, and an existing progress row adds one read.
These fixtures are below Convex's 32,000-document read limit; byte size and
unusually large per-member role or legacy attachment arrays can still constrain
a page. These are synthetic DB-boundary measurements, not a live engine load or
upgrade benchmark.

Until the role completion marker is set, role-expanded sends still scan the
entire members table to avoid silently losing legacy recipients. At 1000
members per minute, completion takes roughly `ceil(memberCount / 1000)` ticks;
large workspaces can still hit transaction document/byte limits on sends during
this interval. After completion expansion uses the reverse role index, but large
recipient sets still have transaction limits. Mention lists remain uncapped.

## Broadcast mentions

`mentionEveryone` and `mentionHere` are optional message metadata; all message
views default missing values to false. Send checks the channel-effective
permission and matching token. Broadcasts never create recipient rows or thread
participants. Read-state and unread badges inspect the markers lazily in their
existing bounded message windows. These windows can omit older mentions; they
are not exhaustive history counts. Thread replies ignore broadcast markers and
treat their tokens as plain text; thread inboxes use participation instead, while
reply push follows channel recipient rules. Thread
inbox reads examine at most 500 participation rows, deduplicate roots before
fetching, and recheck channel access. The inbox selects mentioned threads first,
then by activity, within its 50-row cap
before opening bodies. Output limits do not reduce that candidate read cost.
The always-subscribed badge separately takes 50 mentioned rows through
`threadParticipants.by_user_mentioned` and rechecks roots and access, without
opening bodies. It counts unacknowledged mentions, capped at 50; inaccessible
or stale roots in that window can reduce the count. The populated regression
fixture (500 participation rows, 50 mentioned roots, one public channel) asserts
at most 110 returned documents, including repeated point reads. More distinct
channels, roles, categories or private memberships add authorization reads.
`messages.markThreadMentionsSeen({ lastReplyAt?: number })` clears at most 50
caller-owned mentioned rows through an optional activity watermark; repeat while
its `{ cleared, hasMore }` result reports `hasMore`. A full batch conservatively
reports more. The root mention list cannot resurrect acknowledged rows.

Broadcast dispatch reads at most 200 workspace members (or private/DM channel
members) per scheduled continuation, shares role/category configuration within
the page, and rechecks access, bans, presence and notification preferences per
candidate. The scheduler carries only message IDs and cursors, never the audience
list. Push remains subject to transport retry/duplicate-delivery behavior.

For old clients only, `LEGACY_BROADCAST_EXPANSION_LIMIT = 100` bounds compatibility
expansion. Send examines 101 candidates; if more scanning is necessary to decide
whether the visible audience fits, `broadcastMentionJobs` holds a cursor and at
most 100 candidate IDs, with one row per pending message. Scheduled mutations
read 200 candidates, atomically advance or delete that job, and patch the message
only when the final audience fits. Scheduler payloads contain only the job ID.
No compatibility-expansion job is created for a known large audience; delivery
leases and asynchronous recipient receipts are separate. No marker-specific
message indexes are needed; lazy badges use channel history
indexes and thread participation. Benchmark deployment and busy-channel
subscription costs on representative data before release. No live
engine load, deployment, skipped-version upgrade or restore test was run here.

When compatibility expansion shares `mentionUserIds` with broadcast IDs, optional
`messages.broadcastDirectUserIds` preserves the original explicit/role list.
Message and bot-event views expose that snapshot only when present.
`readStates.summary.massMentionCount` classifies the mass-only subset of its
existing mention scan with no extra reads. Dispatch and first-reply participation use that snapshot, so suppressing mass
mentions or an offline `@here` audience does not swallow an explicit mention.
Marker-only large audiences use the original list directly without duplicating it.


## Broadcast dispatch and thread marker read budgets

Broadcast delivery uses 200-candidate pages with concurrency bounded to 25 for
access/pref work and 50 for presence. Public audience pages reuse the member docs
they enumerate. Active users and offline/stale @here users are removed before
preference reads. The regression fixture compares the council's 1,003 query
probes / 404 returned docs against fewer than 450 probes / 210 returned docs for
an offline @here page; it is a synthetic DB-boundary measurement, not live load.
Unrestricted public sends skip legacy expansion when the maintained member count
already exceeds 100, or after a cheap 101-member page otherwise. Restricted
small audiences can still finish compatibility expansion asynchronously.

Thread queries do not scan channel directories or message marker indexes.
Synthetic tests cover 500 unrelated markers and a mention behind 50 newer
unmentioned threads. Only the legacy array endpoint retains the 500-participation
candidate window. The capability-gated cursor endpoint pages through all
participation rows in 50-candidate batches. The badge uses its separate
50-mentioned-row window.
The manually invoked `maintenance:backfillThreadParticipants {}` documented in
the Docker guide now processes one message and at most 100 mention IDs plus
up to 100 maintained recent repliers per invocation (at most 200 participation writes), resuming with an offset and cursor.
Run it only for legacy repair before acknowledging inbox mentions: replaying it
can rearm historical mentions. No automatic caller is added.
No live populated-upgrade/index-build, busy-channel subscription, or
restore benchmark was performed.

Broadcast delivery uses expiring leases and durable recipient receipts, with a
minute recovery cron as described below. Ordinary non-broadcast dispatch creates
no delivery claim. A claim-then-crash is retried after expiry. External transports
can still duplicate delivery after acceptance but before a receipt commits.
Continuation cursors use the explicit `aulora-broadcast-v1:` prefix; raw Convex
cursors remain opaque.

The hourly `notification delivery claim retention` cron starts bounded 500-row
batches of claims
older than the 24-hour replay window using the built-in `by_creation_time` index.
A full batch immediately schedules another bounded batch until fewer than 500
rows are returned by a batch. Delivery rejects messages aged 24 hours or more,
including after claims expire;
a retention backlog therefore cannot make old jobs deliverable again.
`notifications.dispatchNow` returns `{ sent: 0, skipped: "noop" }`.

## Broadcast delivery recovery

Broadcast sends persist one initial page job in `notificationDeliveryClaims` in
the send transaction, independently of audience size. Dispatch resolves one
bounded audience page, leases it for five minutes, and records per-message/user
receipts during asynchronous delivery, never during send or badge computation.
`notification delivery lease recovery` runs every minute with the
`by_lease(completed, retryAt)` index, reading at most 100 expired and 100
pre-upgrade lease-less claims. Completion removes a row from that pending index
range. Recovery advances `retryAt` without renewing the delivery lease, so repeated
failures cannot starve later pages and completed rows cannot block migration. Recovery and retention are automatic, with no setup command.
The schema adds only optional lease/receipt fields and an index; deploy the
backend first and verify index creation on populated installations.

Tests cover stale-worker fencing, expired/legacy lease reclamation, replay
receipts and cursor paging past 500 thread participation rows. No live upgrade,
provider crash/recovery or hardware load test has been performed. External push
is at least once, with a crash-after-acceptance duplicate window; see the exact
limitation in [release compatibility](../releases.md#broadcast-mention-markers).
The new capability-gated thread inbox pages 50 candidates per query and checks
private membership by point lookup instead of a capped membership list.
