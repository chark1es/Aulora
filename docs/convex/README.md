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

For affected paths, test both a large history and concurrent activity in a busy
channel. Include the number and size of records read, subscription update
volume, and any remaining limits in the PR. Avoid presenting a test with a few
messages as evidence that the path scales.

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

- [deploy.sh](../../infra/docker/deploy.sh) and the
  [staged updater](../../infra/docker/update/stage.mjs) currently recreate the
  web service before running setup. A failed backend deploy can therefore leave
  a new frontend talking to old functions. Fixing this order requires a code
  change; this guide does not change it.
- Those paths do not explicitly recreate the Convex engine. A release that
  changes its pinned image needs a tested runtime-upgrade step, not just a new
  setup image or function deploy. Review the Coolify path separately as well.
- The [setup script](../../infra/docker/setup/entrypoint.sh) currently treats
  the voice-permission migration as best effort. Required future migrations
  need explicit failure handling and completion verification.

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
