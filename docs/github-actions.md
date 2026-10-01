# GitHub Actions builds and releases

Every pull request runs `.github/workflows/ci.yml`. It checks lint, workspace types,
tests, web/docs builds and links, release metadata, infrastructure tests, and workflow syntax.
The native builds for Windows, macOS, Linux, Android, and the iOS simulator are
opt-in because they are slow. They run when a PR has the `build-native` label, when
you start CI manually from the Actions tab (`native` input), and on every release,
which calls CI as a reusable workflow. They are skipped on plain PRs and on pushes to `main`.
These jobs do not receive release credentials. The final `Required checks` job
fails if any other job fails or is cancelled, and treats only the native jobs as
optional when skipped. There are no path filters on PR checks, so
documentation-only PRs also produce the required result.

Configure `main` to require that check from the GitHub Actions app, an up-to-date PR branch,
and resolved review conversations. Apply the rule to administrators and
block force pushes and branch deletion. Review approvals are a maintainer choice.
The same checks run after merges and for merge groups, without the native builds.

The separate [CLA bot](cla-bot.md) records contributor acceptance and publishes the `CLA` commit status on pull requests. After enabling it, require that status alongside `Required checks`. Its privileged job runs default-branch code without executing the PR's code.

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

For a candidate or retry, open [Actions → Release](https://github.com/chark1es/Aulora/actions/workflows/release.yml),
select `main`, and leave `publish` off. It builds the current checked-in version
and uploads the complete release as an Actions artifact. Turning `publish` on
creates the GitHub release after successful builds. The desktop-only candidate
workflow remains available for testing desktop artifacts separately.

For an initial release that needs artifact inspection before publication, set the repository Actions variable `RELEASE_AUTO_PUBLISH=false` before merging the version bump. The push still runs all checks and produces `complete-release`, but skips public release creation. Inspect that exact version's artifacts, then publish the verified files at the built commit. Remove the variable to restore automatic publication for later version bumps. Manual `publish=true` remains an explicit publication request and rebuilds the current main version.

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
