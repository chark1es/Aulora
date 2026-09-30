# GitHub Actions builds and releases

Every pull request runs `.github/workflows/ci.yml`. It checks lint, workspace types,
tests, web/docs builds and links, release metadata, infrastructure tests, workflow syntax, and native builds
for Windows, macOS, Linux, Android, and the iOS simulator. These jobs do not
receive release credentials. The final `Required checks` job fails if any
required job fails, is cancelled, or is skipped. There are no path filters on PR
checks, so documentation-only PRs also produce the required result.

Configure `main` to require that check from the GitHub Actions app, an up-to-date PR branch,
and resolved review conversations. Apply the rule to administrators and
block force pushes and branch deletion. Review approvals are a maintainer choice.
The same checks run after merges and for merge groups.

The separate [CLA bot](cla-bot.md) records contributor acceptance and publishes the `CLA` commit status on pull requests. After enabling it, require that status alongside `Required checks`. Its privileged job runs default-branch code without executing the PR's code.

## Start a release

Complete the [release checklist](releasing.md), then run `bun run release:version -- 1.0.0`
with the intended higher stable version and merge the change to `main`. That version is the release source of
truth. The release workflow runs the complete checks, builds all applications,
and creates `v1.0.0` at the exact commit it compiled only after every build
succeeds. Files upload to a draft first; it becomes the latest release only after the upload completes. A rerun can resume an unpublished draft for the same source commit. Changing other settings without increasing the version does not
publish a release. Existing published versions cannot be overwritten.

For a candidate or retry, open [Actions → Release](https://github.com/chark1es/Aulora/actions/workflows/release.yml),
select `main`, and leave `publish` off. It builds the current checked-in version
and uploads the complete release as an Actions artifact. Turning `publish` on
creates the GitHub release after successful builds. The desktop-only candidate
workflow remains available for testing desktop artifacts separately.

Mobile version strings match the desktop release. The release workflow run
number becomes the Android version code and iOS build number. Re-running the
same workflow run keeps that number; start a new manual run if a store needs a
higher build number.

The repository remains private until you make it public for v1. GitHub release
downloads require repository access while it is private; public downloads and
updater URLs become accessible once the repository is public.

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
and publish GitHub assets; uploading to App Store Connect or Google Play and
obtaining store approval remain separate steps.

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
explicit distributable files. Android release jobs disable Gradle caching to
avoid caching signed outputs or private build inputs.
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
