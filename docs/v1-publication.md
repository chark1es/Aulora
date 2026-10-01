# V1 publication review

Reviewed 2026-09-30 against `c6ed2fe8cff075d3805511ed70056ffcfece8326` and the isolated `release/v1.0.0` worktree. This record distinguishes build evidence from acceptance checks that still need a person or a deployed service.

## Verified

- [Full main CI](https://github.com/chark1es/Aulora/actions/runs/36797108956) passed source checks, native compilation for macOS/Windows/Linux/Android/iOS simulator, workflow validation, and the secret history scan.
- Local frozen install and `bun run check` passed after synchronizing the 25 release metadata files to 1.0.0 and formatting the desktop JSON configuration.
- Local `gitleaks git --redact=100 --config .gitleaks.toml` scanned 296 commits with no findings. The scan uses the repository's two exact fixture exceptions.
- All 19 required release-signing secret names exist in the restricted GitHub environment. Its deployment policy permits `main` only. The signed candidate validates whether the supplied values work.
- Main branch protection requires up-to-date `Required checks`. The repository has one recorded human commit author. Legal acceptance and asset rights remain publisher decisions.
- The App Store Connect API key authenticated successfully. No iOS app record matched `dev.spwnd.aulora` at the time of review.
- The mobile testing workflow downloads the published APK/AAB/IPA and checks their SHA-256 hashes before an optional TestFlight upload. It does not send invitations or declare store approval.
- The publisher clarified that testers use their own servers. The iOS App Review demo opens from a reserved server address, not a visible button, and uses an isolated in-memory chat session before any server profile is saved. It supplies no hosted backend and makes no claim to verify live calls or push.

## Build and distribution evidence

The [initial signed candidate run](https://github.com/chark1es/Aulora/actions/runs/36802151249) passed every source/native CI check, then exposed missing secret inheritance between the caller and reusable signing workflows. Apple and Android jobs received empty secrets. The v1 preparation fixes the caller with `secrets: inherit`. The v1 release pipeline checks all platforms again, collects signed mobile files and desktop updater signatures, and produces a complete asset set only after all jobs succeed. The initial publication hold permits inspecting these files before publication.

Publication, artifact inspection, public downloads, and TestFlight upload results will be recorded after those actions. A prepared workflow is not evidence of an uploaded or installable TestFlight build.

## Checks still open

- Installed signed desktop builds on supported systems and physical Android/iOS acceptance tests.
- Public HTTPS/WSS, OAuth/SSO callbacks, multi-account denied actions, TURN calls, and foreground/background/locked-device push delivery.
- Native license inventories, the JavaScript license-text review queue, and ownership/redistribution permission for project assets. The local notice generator found 98 packages requiring upstream license-text review. Most declare permissive licenses; that alone does not close the queue.
- Stable hosted docs, privacy/support URLs, store data disclosures, account-deletion requirements, screenshots, and any review credentials.
- Apple upload/processing, TestFlight group setup, and external Beta App Review if public testing is offered. The publisher created app record `6817986490` on 2026-09-30, and its bundle ID and English locale were verified through Apple's API.
- Google Play app creation and track setup if AAB-based testing is wanted. A signed APK can be tested directly.
- CLA acceptance records and adding the `CLA` branch status requirement after the bot has recorded real contributor acceptance. The workflow permission fix allows comments on PRs; it cannot sign an agreement for a person.

The release notes disclose unverified runtime behavior and mobile store availability. Keep the unchecked items in [the full checklist](releasing.md) until their evidence exists.
