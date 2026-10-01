# Preparing and publishing a release

This is the maintainer checklist for v1 and later stable releases. Completing a source check does not publish a release or verify signed devices. Record the commit, date, result, and evidence for each release check.

## Version and publication trigger

The release workflow reads `apps/desktop/src-tauri/tauri.conf.json`. A higher stable version merged into `main` triggers the complete release pipeline and automatically publishes after every required check and artifact build succeeds. Do not merge a version bump before the publication checks below are complete.

Use the version command to keep backend discovery, web defaults, package metadata, and native versions aligned:

```sh
bun run release:version -- 1.0.0
bun install --frozen-lockfile
bun run check
```

Only stable `major.minor.patch` versions are supported by the release automation. API discovery's `apiVersion` is separate and remains 1 unless that contract changes.

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

- [ ] Run `bun install --frozen-lockfile` with Bun 1.4.0 and Node.js 22.18.0.
- [ ] Run `bun run check`, desktop configuration verification, and the required native CI builds.
- [ ] Install a fresh isolated stack using the documented installer. Verify setup completes and reruns without regenerating the encryption key.
- [ ] Verify discovery, owner sign-in, registration/invite-only policy, roles, and denied actions with a second account.
- [ ] Exercise messages, DMs, threads, reactions, editing, search, pinned messages, uploads/downloads, reconnect, and workspace switching.
- [ ] Verify voice/video with separate devices and a restrictive network requiring TURN.
- [ ] Test the intended public HTTPS/WSS deployment from another network. Check DNS, cookies, provider callbacks, proxy upload limits, and private administrative ports.
- [ ] Replace example database and MinIO credentials in production.
- [ ] Test backup creation with uploaded files, copy it off-machine, and restore it to an isolated stack using the original key. Verify both old messages and downloaded files.
- [ ] Exercise server update check/download/restart and document migration/recovery steps.

## Signed applications and services

- [ ] Check release-signing secrets against [GitHub Actions](github-actions.md) and [credential setup](release-credentials.md). Do not put secrets in Git or release notes.
- [ ] Install both macOS architecture builds and verify signing/notarization, menus, tray, deep links, notifications, and restart/update behavior.
- [ ] Install/uninstall the unsigned Windows release on a clean machine; document the publisher warning.
- [ ] Install the Linux AppImage and Debian package; test the AppImage updater.
- [ ] Install the Android APK and the iOS TestFlight build on physical devices.
- [ ] Verify push permissions, foreground/background/locked-device alerts, denied permissions, notification taps, logout, and server switching.
- [ ] If offering an official relay, publish its address and onboarding/access process and test it. A configured local relay is not a public managed service.
- [ ] Publish the privacy-policy URL, support URL, required account-deletion flow, store screenshots/descriptions, and accurate store data disclosures.
- [ ] Upload to App Store Connect and Google Play and obtain approval separately. The release workflow uploads GitHub assets, not store submissions.

## Final artifacts and announcement

- [ ] Prepare release notes from `CHANGELOG.md`, including known limitations and any migration steps.
- [ ] Download the candidate `complete-release` artifact and inspect every distributable.
- [ ] Verify `latest.json` has all four desktop updater targets and valid signatures.
- [ ] Verify `SHA256SUMS`, license/notice files, and the web/docs and legal ZIP contents.
- [ ] Host the docs site and privacy policy at stable public URLs and test navigation on desktop and mobile.
- [ ] Merge the version bump to publish, or manually dispatch Release on `main` with `publish=true` for an unpublished current version.
- [ ] Verify the release tag points to the built commit, assets are publicly downloadable, and updater/discovery URLs work.
- [ ] Replace the changelog's release-candidate heading with the version and actual publication date.

Windows installers are unsigned in the initial distribution. iOS IPA downloads are App Store submissions, and mobile store availability depends on approval. State these limitations in release notes.

## Recovery

A failed build must not publish a partial release. Inspect the failing job, fix it, and rerun a candidate. An unpublished draft for the same commit can be resumed; a published version cannot be overwritten. Increase the patch version for a corrected public release.

Do not remove an updater signing key without a migration plan for installed clients. Do not assume an application rollback reverses backend schema changes. Keep a compatible data backup, encryption key, deployment settings, and the previous source revision available.
