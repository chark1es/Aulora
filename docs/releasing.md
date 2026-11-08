# Preparing and publishing a release

This is the maintainer checklist for v1 and later stable releases. Completing a source check does not publish a release or verify signed devices. Record the commit, date, result, and evidence for each release check.

## Version and publication trigger

The release workflow reads `apps/desktop/src-tauri/tauri.conf.json`. A higher stable version merged into `main` triggers the complete release pipeline and automatically publishes after every required check and artifact build succeeds. Do not merge a version bump before the publication checks below are complete.

For an initial release, set the repository Actions variable `RELEASE_AUTO_PUBLISH=false` before merging the version preparation. This builds the exact v1 candidate without publishing. Inspect its complete artifact set before creating the public release at that build's commit. Remove the variable after publication to restore automatic releases. This hold does not close the remaining acceptance checks.

Use the version command to keep backend discovery, web defaults, package metadata, and native versions aligned:

```sh
bun run release:version -- 1.0.0
bun install --frozen-lockfile
bun run check
```

Only stable `major.minor.patch` versions are supported by the release automation. API discovery's `apiVersion` is separate and remains 1 unless that contract changes.

`main` is the development branch. The long-lived `release` branch is the stable install and Coolify deploy target. After a stable release is published, the Sync release branch workflow opens a promotion PR into `release` and enables auto-merge after required checks. Enable the repository automation settings described in [GitHub Actions builds and releases](github-actions.md#start-a-release).

For a candidate, run [Actions, Release](https://github.com/chark1es/Aulora/actions/workflows/release.yml) on `main` with `publish=false`. It builds the current version and uploads a `complete-release` artifact without publishing. For v1, finish preparation at the current version, build a candidate, then merge the v1 version bump once ready. To test v1 installers separately, use the desktop candidate workflow with `version=1.0.0`; mobile candidates use the main Release workflow's current version.

## Repository and licensing

- [ ] Review the public README and all setup guides from a clean checkout.
- [ ] Confirm `LICENSE` is the unchanged PolyForm Noncommercial 1.0.0 text, with `NOTICE` included in distributions.
- [ ] Confirm free personal/noncommercial use and paid business use are consistent in package metadata and docs.
- [ ] Confirm commercial requests and private security reports reach `cnguyen@spwnd.dev`.
- [ ] Review the CLA, confirm rights for existing contributions, and enable the [CLA bot and required status](cla-bot.md#enable-the-check) for future contributions.
- [ ] Run `bun run notices`. Review packages without license text and retain upstream attribution for generated icons.
- [ ] Generate and review Rust, CocoaPods, Gradle, and distributed-container notices for the actual release artifacts. The JavaScript inventory does not cover them.
- [ ] Verify logo/icon/sound/other asset provenance and document any attribution.
- [ ] Scan all Git history and release/build artifacts for real credentials or user data, using `gitleaks git --redact=100` with the repository configuration. CI runs this scan too. The two fixture exceptions match exact example values in exact files. `release:check` catches sensitive tracked filenames, but does not replace a content/history scan.
- [ ] If a secret was ever committed, revoke it before publication. Ignoring or deleting a file does not remove it from history.
- [ ] Set a repository description, homepage, and appropriate topics. Make visibility public only after the history review.
- [ ] Enable private vulnerability reporting and verify the security email. Configure the `Required checks` branch rule and restrict the `release-signing` environment to `main`; these settings cannot be enforced by committing YAML alone.

## Source and deployment checks

- [ ] Run `bun install --frozen-lockfile` with Bun 1.4.4 and Node.js 22.23.4.
- [ ] Run `bun run check`, desktop configuration verification, and the required native CI builds.
- [ ] Install a fresh isolated stack using the documented installer. Verify setup completes and reruns without regenerating the encryption key.
- [ ] Verify discovery, owner sign-in, registration/invite-only policy, roles, and denied actions with a second account.
- [ ] Exercise messages, DMs, threads, reactions, editing, search, pinned messages, uploads/downloads, reconnect, and workspace switching.
- [ ] Verify voice/video with separate devices and a restrictive network requiring TURN.
- [ ] Test the intended public HTTPS/WSS deployment from another network. Check DNS, cookies, provider callbacks, proxy upload limits, and private administrative ports.
- [ ] Replace example database and MinIO credentials in production.
- [ ] Test backup creation with uploaded files, copy it off-machine, and restore it to an isolated stack using the original key. Verify both old messages and downloaded files.
- [ ] Exercise server update check/download/restart and document migration/recovery steps. For backend, schema, subscription, engine, or updater changes, complete the applicable [Convex performance and upgrade checks](convex/README.md#verification-before-release), including populated older installs, skipped versions, client compatibility, failed-update retries, and recovery.
- [ ] Decide whether this release needs a minimum/recommended client version, a kill switch, or a staged desktop rollout. Record the chosen values and the rollback plan in the release notes.
- [ ] Run `bun run release:check` (includes the schema snapshot gate) and `bun --cwd packages/convex run test -- test/compat/schema-compat.test.ts` before merging the version bump.

## Upgrade safety controls

### Client compatibility gate

`server.publicConfig.clientVersion` advertises two optional settings read from the deployment environment:

| Variable | Effect | Default |
| --- | --- | --- |
| `AULORA_MIN_CLIENT_VERSION` | Clients older than this show an update-required screen and cannot continue into the workspace. | unset (no gate) |
| `AULORA_RECOMMENDED_CLIENT_VERSION` | Older clients still work but see a dismissible update notice. | unset (no notice) |

Both accept a full stable SemVer such as `1.4.0`; an invalid value is ignored. The client compares against the version injected from its own manifest at build time. Desktop's action starts the signed updater, web reloads for the newest bundle, and a mobile client should link to its store listing.

Bump procedure:

1. Ship the backend change with a schema and API that accept the previous supported client, and publish the client that understands the new behavior.
2. Verify the new client against the new backend before enforcing anything.
3. Set `AULORA_RECOMMENDED_CLIENT_VERSION` first for visibility; raise `AULORA_MIN_CLIENT_VERSION` only once every supported client can actually install the new build. Raising it early strands users with no update path.
4. Keep the minimum in place while the incompatible backend is running. Lower it only with a compatible backend.
5. Never set the minimum above the oldest client the release notes still support.

### Kill switches

`server.settings` stores three optional booleans, all defaulting to `false` (feature enabled). They are advertised through `server.publicConfig.features` and read with `resolveFeatureFlags`; unknown or malformed values fall back to enabled.

| Setting | Disables |
| --- | --- |
| `disableNewCallTransport` | The new call transport path. |
| `disablePipVideo` | Picture-in-picture video. |
| `disableAutoDegrade` | Automatic call quality degradation. |

A workspace manager sets them with `server.updateSettings`; clients see the new value on their next config read. Use them to turn off a new path during an incident without shipping a client. They are product guards, not authorization: keep every server-side permission and validation check in place.

### Staged desktop rollout

The desktop updater reads an optional top-level `rollout` percentage from the static `latest.json` manifest. Omitted or `100` keeps the previous behavior. Each installation persists an `update-client-id` in its app config directory; the shell hashes that id into a stable 0–99 bucket and only offers the update when the bucket is below the percentage.

- Set the percentage with the Release workflow's `rollout` input, or `RELEASE_ROLLOUT` when running `scripts/ci/assemble-release.mjs` directly. The manifest builder rejects values outside 0–100.
- Limitation: the feed is a static GitHub release asset. GitHub still serves the artifacts to anyone who asks, so this is staged delivery, not access control. A published release cannot be re-gated without publishing a new version; plan the percentage when publishing.
- Use `100` for security fixes. Stage risky client changes instead.

### Schema compatibility gate

- `packages/convex/test/fixtures/compat/vX.Y.Z/*.json` holds synthetic documents shaped like a supported older release. Add a folder for each supported release; `packages/convex/test/compat/schema-compat.test.ts` inserts every document through the current validators with `convex-test`.
- `scripts/ci/schema-snapshot.json` records each table's required/optional fields. `node scripts/ci/check-schema-compat.mjs` (also run by `release:check`) fails when a field becomes required, a required field is added, or a table/field is removed.
- An intentional tightening after a completed backfill is allowed with a marker comment in `schema.ts`:
  `// @compat-allow-tighten: server.exampleField -- backfill ...`
- After an intentional change, run `node scripts/ci/check-schema-compat.mjs --update`, review the snapshot diff, and commit it with the schema change.

### Deploy order and rollback

`infra/docker/deploy.sh` and the staged updater now deploy the backend (`setup`) before recreating the web container. The release schema and functions must accept both the old and new frontend during that window. A failed `setup` leaves the previous web container serving.

`deploy.sh` pins the serving web image as `aulora-web:previous` and records its id plus the deployed version in `infra/docker/.deployed-web-image.json` before rebuilding. `./deploy.sh --rollback` verifies that pin, restores it as `aulora-web:local`, and recreates only the web service. Backend functions and schemas are **not** rolled back; use a compatible backup/restore when a migration is irreversible. See [Convex recovery](convex/README.md#deploy-a-release-in-a-safe-order).

## Signed applications and services

- [ ] Check release-signing secrets against [GitHub Actions](github-actions.md) and [credential setup](release-credentials.md). Do not put secrets in Git or release notes.
- [ ] Install both macOS architecture builds and verify signing/notarization, menus, tray, deep links, notifications, and restart/update behavior.
- [ ] Install/uninstall the unsigned Windows release on a clean machine; document the publisher warning.
- [ ] Install the Linux AppImage and Debian package; test the AppImage updater.
- [ ] Install the Android APK and the iOS TestFlight build on physical devices.
- [ ] Verify push permissions, foreground/background/locked-device alerts, denied permissions, notification taps, logout, and server switching.
- [ ] If offering an official relay, publish its address and onboarding/access process and test it. A configured local relay is not a public managed service.
- [ ] Publish the privacy-policy URL, support URL, required account-deletion flow, store screenshots/descriptions, and accurate store data disclosures.
- [ ] Run the store compliance scan against the project and the built Android bundle: `greenlight preflight . --exit-code` and `greenlight playscan . --aab <path>`. Fix CRITICAL and HIGH findings before upload, and enter the deletion URL and data-safety answers in Play Console.
- [ ] Upload to App Store Connect and Google Play and obtain approval separately. TestFlight uploads use the mobile testing workflow; Google Play uploads can run from the release workflow's optional `play-track` input. Neither replaces store review.

## Final artifacts and announcement

- [ ] Review the release notes (GitHub Releases is the changelog). Later versions generate notes automatically; supply the manual Release workflow's `notes` input to include known limitations and any migration steps.
- [ ] Download the candidate `complete-release` artifact and inspect every distributable.
- [ ] Verify `latest.json` has all four desktop updater targets and valid signatures.
- [ ] Verify `SHA256SUMS`, license/notice files, and the web/docs and legal ZIP contents.
- [ ] Host the docs site and privacy policy at stable public URLs and test navigation on desktop and mobile.
- [ ] Merge the version bump to publish, or manually dispatch Release on `main` with `publish=true` for an unpublished current version.
- [ ] Confirm the promotion PR created by Sync release branch passed its checks and merged, then confirm a fresh `git clone --branch release` reports the expected version. It promotes the current `main`, which may have advanced beyond the built commit. If promotion fails, resolve merge conflicts or workflow permissions and retry the sync workflow with the published tag.
- [ ] Verify the release tag points to the built commit, assets are publicly downloadable, and updater/discovery URLs work.

Windows installers are unsigned in the initial distribution. iOS IPA downloads are App Store submissions, and mobile store availability depends on approval. State these limitations in release notes.

## Recovery

A failed build must not publish a partial release. Inspect the failing job, fix it, and rerun a candidate. An unpublished draft for the same commit can be resumed; a published version cannot be overwritten. Increase the patch version for a corrected public release.

Do not remove an updater signing key without a migration plan for installed clients. Do not assume an application rollback reverses backend schema changes. Keep a compatible data backup, encryption key, deployment settings, and the previous source revision available.
