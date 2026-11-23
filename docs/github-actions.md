# GitHub Actions builds and releases

Every pull request runs `.github/workflows/ci.yml`, but only the checks that the
changed paths can affect. A `changes` job detects the paths first, and the other
jobs are skipped when nothing they cover changed:

| Job | Runs when the PR touches | Checks |
| --- | --- | --- |
| Tests and types | `apps/web`, `apps/mobile`, `apps/desktop`, docs generators, `packages`, `scripts`, root configs, lockfile | lint, types, tests, workspace build, bundle and embed budgets (Turbo cache restored between runs) |
| Documentation | the above, plus `apps/docs`, `docs`, any Markdown | `docs:check` and the docs generator tests |
| Release metadata and scripts | `scripts`, desktop release config, Compose files, legal files, or anything in Tests and types | `release:check`, `test:release` |
| Infrastructure tests | `infra`, `install.sh`, `install.ps1`, `packages/core` | `test:infra` |
| Workflow validation | `.github` | actionlint (pinned Docker image) with shellcheck |
| Image build | `infra`, `.dockerignore`, `bun.lock`, `package.json` | each image builds for amd64, without pushing |
| Desktop, Android, iOS | their native project paths, the `build-native` label | native compile |
| Secret scan | always | gitleaks over the PR's commits only |

Pushes to `main`, merge groups, manual runs and workflow calls (releases, mobile
OTA) ignore the filters and run every check except the image build, so `main` and
every release commit are fully verified. The native builds for Windows, macOS,
Linux, Android and the iOS simulator are slow, so they run on a PR only when it
has the `build-native` label or touches the matching native paths, when you start
CI manually from the Actions tab (`native` input), or when another workflow calls
CI with `native: true`. Release automation calls CI with `native: false`: its
signed desktop and mobile release builds already gate assembly and publication.
These jobs do not receive release credentials. The final `Required checks` job is
the single required status. It fails if any job failed or was cancelled, or if
path detection or the secret scan did not succeed, and it accepts a skipped job
because a filter excluded it. Documentation-only PRs therefore still produce the
required result.

Configure `main` to require that check from the GitHub Actions app, an up-to-date PR branch,
and resolved review conversations. Apply the rule to administrators and
block force pushes and branch deletion. Review approvals are a maintainer choice.
The same checks run after merges and for merge groups, without the native builds.
There is no `release` branch to protect: releases are tags, and the repository
should not keep a branch of that name.

The separate [CLA bot](cla-bot.md) records contributor acceptance and publishes the `CLA` commit status on pull requests. After enabling it, require that status alongside `Required checks`. Its privileged job runs default-branch code without executing the PR's code.

The shared JavaScript setup caches Bun downloads by OS, architecture, runtime
version and lockfile; every job still runs `bun install --frozen-lockfile`.

## Performance and regression guards

The `quality` job enforces three guards after the workspace build:

- `bun run perf:bundle` compares every `apps/web/dist` asset, the initial chunk
  graph, and total bundle size with the committed budget, and fails if LiveKit,
  MediaPipe or RNNoise becomes reachable from the initial graph.
- `bun run perf:embed` checks the frontend Tauri embeds against its size
  ceiling.
- `bun run perf:convex` rejects new unbounded Convex reads; it runs as part of
  `bun run lint`.

All three are required checks. [Performance and regression guards](performance.md)
explains each rule, how `--update` works, and how to add a reviewed exception.
The `apps/web/e2e` Playwright suite is not part of these checks: it needs a live
deployment and credentials.

## PR-Agent reviews

[PR-Agent](https://github.com/The-PR-Agent/pr-agent) runs separately from CI in
[`.github/workflows/pr-agent.yml`](../.github/workflows/pr-agent.yml). It reviews
non-draft PRs when opened, reopened, marked ready, or updated. It updates a
persistent review comment. Automatic description changes and code suggestions
are disabled; maintainers can request them with commands.

Add the `OPENROUTER_API_KEY` secret to the `pr-review` environment in
[environment settings](https://github.com/chark1es/Aulora/settings/environments).
Get a key from [OpenRouter](https://openrouter.ai/settings/keys). The default
model is [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash),
`openrouter/deepseek/deepseek-v4.1-flash`. OpenRouter receives the PR
diff and repository context and bills API usage to that key.

With GitHub CLI, run this command and enter the key at its hidden prompt:

```sh
gh secret set OPENROUTER_API_KEY --env pr-review --repo chark1es/Aulora
```

Merge the workflow and [`.pr_agent.toml`](../.pr_agent.toml) to `main`, then open
or update a ready PR. Check its review comment and the `PR-Agent` workflow run.
Missing credentials produce a setup error. PR-Agent is advisory and is not part
of `Required checks`.

Repository owners, organization members, and collaborators can post these PR
comments. Ordinary discussion, bot comments, and external contributor commands
do not run the agent:

```text
/review
/improve
/ask "Does this change affect mobile reconnects?"
/describe
/help
```

`/describe` posts a summary comment. To change the model, set the `PR_AGENT_MODEL`
Actions variable to `openrouter/` followed by an OpenRouter model ID.
Keep `custom_model_max_tokens` in `.pr_agent.toml` within the model's context
limit. [PR-Agent model configuration](https://docs.pr-agent.ai/usage-guide/changing_a_model/).

The workflow uses `pull_request_target` for fork PRs and fetches content through
the GitHub API. It never checks out or executes PR code. Its token can read
repository content and write PR/issue comments, but cannot push commits.
Repository configuration and context come from the default branch. The Docker
image is pinned by digest to the `0.46.0-github_action` release; verify a new
release's image digest before updating it.

## Start a release

Complete the [release checklist](releasing.md), then run `bun run release:version -- 1.0.0`
with the intended higher stable version and merge the change to `main`. That version is the release source of
truth. The release workflow runs the complete checks, builds all applications,
and creates `v1.0.0` at the exact commit it compiled only after every build
succeeds. Files upload to a draft first; it becomes the latest release only after the upload completes. A rerun can resume an unpublished draft for the same source commit. Changing other settings without increasing the version does not
publish a release. Existing published versions cannot be overwritten.

Before the GitHub release exists, the pipeline publishes the container images
(see [Container images](#container-images)). There is no promotion branch or
extra credential: a published release is the tag `v1.0.0` plus its GitHub Release
assets, and self-hosters install or upgrade to that tag.

For a candidate or retry, open [Actions → Release](https://github.com/chark1es/Aulora/actions/workflows/release.yml),
select `main`, and leave `publish` off. It builds the current checked-in version
and uploads the complete release as an Actions artifact. It also pushes the
container images tagged `sha-<commit>` only, never a version tag. Turning `publish` on
creates the GitHub release after successful builds. Set the optional
`play-track` input to also upload the signed Android AAB to a Google Play track.
The desktop-only candidate workflow remains available for testing desktop
artifacts separately.

Release notes use the manual `notes` input when supplied. Otherwise, v1 uses
`docs/release-notes-v1.md`, a version handled by `checkedInNotes` uses its
checked-in `docs/release-notes-vX.Y.Z.md` file, and other versions use GitHub's
automatically generated notes for the built commit. Use the checked-in file when
a release needs migration steps or known limitations that generated notes cannot
carry. The same text goes into the GitHub release,
the `RELEASE_NOTES.md` asset, and `latest.json` for desktop updates. Notes are
prepared for candidates too, and refreshed when resuming an unpublished draft.
GitHub Releases is the changelog. Review the generated notes and supply manual
notes when a release needs migration instructions or known limitations.

For an initial release that needs artifact inspection before publication, set the repository Actions variable `RELEASE_AUTO_PUBLISH=false` before merging the version bump. The push still runs all checks and produces `complete-release`, but skips public release creation. Inspect that exact version's artifacts, then publish the verified files at the built commit. Remove the variable to restore automatic publication for later version bumps. Manual `publish=true` remains an explicit publication request and rebuilds the current main version.

Mobile version strings match the desktop release. The release workflow run
number becomes the Android version code and iOS build number. Re-running the
same workflow run keeps that number; start a new manual run if a store needs a
higher build number.

The repository remains private until you make it public for v1. GitHub release
downloads require repository access while it is private; public downloads and
updater URLs become accessible once the repository is public.

## Container images

Every release publishes seven multi-architecture images (linux/amd64 and
linux/arm64) to GitHub Container Registry, under the repository owner's
lowercased name:

`ghcr.io/chark1es/aulora-web`, `aulora-setup`, `aulora-smtp-gateway`,
`aulora-bot-runner`, `aulora-transcriber`, `aulora-backup` and
`aulora-push-relay`.

[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) builds them.
Each image and architecture builds in parallel on a native runner (`ubuntu-24.04`
and `ubuntu-24.04-arm`, no emulation) and pushes by digest. A manifest job then
combines the two digests into one tag, `sha-<commit>`. Builds use the GitHub
Actions cache, one scope per image and architecture, and carry OCI labels
(source repository, version, revision, license) so the package links to the
repository. Only the pushing jobs get `packages: write`.

The Release workflow calls it twice. The `images` job builds in parallel with the
desktop, mobile and web builds. The `tag-images` job runs after everything is
assembled and before the GitHub Release is published. It adds the tags `X.Y.Z`,
`X.Y`, `X` and `latest` to the existing `sha-<commit>` manifests, so a published
release never lacks its images, and a failed release leaves no version tag.
The floating tags only move forward: re-publishing an older release does not move
`latest`. Candidate runs (`publish` off) keep only the `sha-<commit>` tag.

To retry or repair the tags of an existing release, run
[Docker images](https://github.com/chark1es/Aulora/actions/workflows/docker.yml)
from `main` with `ref` set to its tag (for example `v1.7.0`), `version` `1.7.0`,
`push` and `release-tags` on. It rebuilds from that tag and refuses a `ref` that
is not the release's tag commit. Pushing is limited to runs on `main`; without
`push` the workflow only builds.

The Compose files name these images (`image:` with a `build:` fallback). A
checkout of a release tag pulls them. A development checkout builds locally with
`AULORA_IMAGE_TAG=local`. The pull-or-build rule is in
[`infra/docker/README.md`](../infra/docker/README.md).

Packages created from a user account start private. After the first release
publishes them, open each package's settings at
`https://github.com/users/chark1es/packages/container/<name>/settings` (or the
organization's packages page), grant the Aulora repository access under
**Manage Actions access** so the workflow can keep pushing, and set **Change
visibility** to **Public**. Until you do, self-hosters cannot pull anonymously and
`docker compose pull` fails with a denied error.

## Release files

| Platform | Output | Signing |
| --- | --- | --- |
| macOS Apple Silicon and Intel | DMGs and distinct updater archives | Developer ID and Apple notarization, plus updater signatures |
| Windows x64 | NSIS installer | Unsigned installer, signed updater artifact |
| Linux x64 | AppImage and Debian package | AppImage updater signature |
| Android | APK and Play Store AAB | Private release keystore |
| iOS | App Store IPA | Apple Distribution and production APNs entitlement |
| Web and docs | ZIP archives | No signing credentials needed |

`latest.json` contains all four desktop updater targets. Mac archive filenames
include the architecture so one cannot overwrite the other. `SHA256SUMS` covers
every release asset. License, copyright notice, commercial-use instructions,
and generated JavaScript notices accompany the release and web/docs archives. A legal ZIP contains upstream license files. Signed mobile builds embed the notices; desktop bundles include the source license and required notices.

The iOS IPA uses your App Store profile. It is for App Store Connect/TestFlight,
and cannot be installed directly on arbitrary iPhones. These workflows compile
and publish GitHub assets. To also push the signed Android AAB to a Google Play
track from the same run, set the manual `play-track` input (`alpha` for closed
testing, or `internal`, `beta`, `production`). That step uses the
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret and runs whether or not `publish` is
set. Leave `play-track` empty to build without uploading. A manual run uses
only its `play-track` input; an automatic release run uses the `PLAY_TRACK`
repository variable. TestFlight uploads use the
[mobile testing workflow](mobile-testing.md), and obtaining store approval
remains a separate step.

## Signing secrets

Configure the following Actions secrets in the
[`release-signing` environment](https://github.com/chark1es/Aulora/settings/environments).
Its deployment branch policy permits only `main`.

| Secrets | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE_BASE64`, `MACOS_CERTIFICATE_PASSWORD` | Encrypted Developer ID certificate and private key |
| `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD` | Encrypted Apple Distribution certificate and private key |
| `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_SIGNING_IDENTITY` | App Store provisioning and matching identity |
| `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY` | Apple signing metadata |
| `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_PRIVATE_KEY` | macOS notarization authentication |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Desktop updater signing |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Android distribution signing |
| `ANDROID_GOOGLE_SERVICES_JSON` | Firebase client configuration compiled into the Android app |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Optional Google Play upload, used only by the manual `play-track` release input |

GitHub encrypts secret values and does not expose them for later reading in the
settings UI. Trusted release jobs must decrypt them to sign applications.
Anyone allowed to change and run trusted workflows could use those credentials,
so restrict write/admin access to trusted maintainers. PR jobs reference no
signing secrets, and only release jobs use the restricted environment.
[GitHub secrets documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

Certificates are imported into temporary runner keychains. Private files are
written under `RUNNER_TEMP` with restricted permissions and removed in cleanup
steps. Android's Firebase client JSON is temporarily written to its required
native build path and removed afterward. Release uploads include only the
explicit distributable files. The Android jobs cache downloaded Gradle
dependencies, but exclude Gradle's build cache so task outputs cannot be
restored from an earlier build. The iOS jobs cache CocoaPods downloads, keyed by
`Podfile.lock`. Neither cache holds signing material.
[GitHub Apple signing instructions](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications).

The APNs `.p8` and FCM service-account private key are not uploaded to app-build
CI. They belong on the push relay server. Firebase's Android client JSON
contains client identifiers intended to be compiled into the application;
it does not include the FCM service-account private key.
[Firebase client configuration](https://firebase.google.com/docs/android/google-services-plugin-and-file).

Keep the local originals and updater key backed up. `.secrets/`, private keys,
keystores, provisioning profiles, and Firebase configuration files are ignored
by Git. Certificate export passwords are kept locally in the ignored credentials
folder, separately from the encrypted PKCS12 files.

## Faster desktop and mobile updates

Desktop continues to use signed, platform-specific packages and the existing
`latest.json` updater feed. The desktop release workflow builds and checks the
web frontend once on Linux, then passes that same artifact to all four native
builds. The Tauri build hook is disabled only for those artifact-consuming jobs.
Rust caches include the application crate and use a separate key for each target;
signing and notarization still run on each release.

Mobile has a separate **Mobile OTA update** workflow for JavaScript and assets.
It runs the ordinary quality checks with native compilation disabled, then
publishes both platform bundles through Expo Update. Full releases still build
APK, AAB and IPA files. Native module, permission, configuration, icon or dependency
changes require another full release.

To activate mobile OTA:

1. Create/link the Aulora Expo project and set the repository variable
   `EAS_PROJECT_ID` to its UUID. Set the `EXPO_TOKEN` secret in the
   `release-signing` environment to an Expo token with update publishing access.
2. Create the `production` channel and its branch in that Expo project. Configure
   the Expo `production` environment with the same `EAS_PROJECT_ID`; SDK 58's
   update command uses that environment when exporting. Keep build-affecting
   environment settings consistent with the native release jobs.
3. Publish and install a new full release. Its native builds synchronize the
   update URL, channel and runtime into AndroidManifest.xml and Expo.plist.
   Without `EAS_PROJECT_ID`, releases keep remote updates disabled and local
   development needs no Expo account.
4. After merging a JavaScript/assets change to `main`, dispatch **Mobile OTA
   update** on `main`, supplying the installed full release's `vX.Y.Z` tag and
   an update description. No Gradle or Xcode compilation runs in that workflow.

The runtime is a SHA-256 hash of committed native inputs, including both native
projects, Expo config, plugins, app icon, mobile manifest, and the workspace
lockfile. The check compares the current runtime with the supplied tag and with
`mobile-ota.json` downloaded from that published release. A missing marker,
disabled OTA, different Expo project or changed runtime fails before publishing.
This deliberately rejects even unrelated lockfile changes; ship a full release
rather than bypassing the guard. Keep the app version unchanged for OTA fixes:
changing the mobile manifest creates a new runtime, and OTA does not replace the
store version or satisfy a higher server minimum-client requirement.

Updates download in the background at launch and apply on a subsequent launch,
without reloading an active call. Startup can use the embedded bundle offline.
Use Expo's update dashboard or `eas update:rollback` from an authenticated checkout
to select a previous compatible update or the embedded bundle during an incident.
See [Expo rollback guidance](https://docs.expo.dev/eas-update/rollbacks/).
Older apps that shipped without `expo-updates` need a store/full-package update
first. Validate download, subsequent launch, offline startup and rollback on both
platforms before treating the new update path as production verified.

The added native Expo modules require CocoaPods dependency resolution, so iOS
jobs use `pod install` with the existing lockfile rather than deployment mode.
Regenerate and review `apps/mobile/ios/Podfile.lock` on macOS when changing native
dependencies. ReachabilitySwift, the additional non-JavaScript pod, is pinned in
the Podfile; Expo module versions are resolved by `bun.lock`.
