## Aulora 1.7.0

### Self-hosting

- Every release now publishes multi-architecture (amd64 and arm64) server
  images to GitHub Container Registry: `ghcr.io/chark1es/aulora-web`,
  `aulora-setup`, `aulora-smtp-gateway`, `aulora-bot-runner`,
  `aulora-transcriber`, `aulora-backup` and `aulora-push-relay`. Each is tagged
  `1.7.0`, `1.7`, `1` and `latest`.
- The Compose files default to the image for the checked-out version
  (`AULORA_IMAGE_TAG`, `AULORA_IMAGE_REGISTRY`). The installer, `deploy.sh` and
  the staged updater pull these images when the checkout is at a release tag,
  and build locally anywhere else, falling back to a local build if a pull
  fails. Use `deploy.sh --build` to force a local build.
- Installs and upgrades now follow GitHub Releases instead of the `release`
  branch. Clone the repository and run `./install.sh`; it checks out the newest
  stable tag. Coolify deployments set their Branch field to a release tag such
  as `v1.7.0`.

### CI and release pipeline

- Pull request checks run only the jobs affected by the changed paths. Native
  desktop, Android and iOS compiles also run when their projects change.
- The release-branch promotion workflow has been removed.

### Upgrade notes

- No schema migration, discovery API change or minimum-client increase is
  required. Discovery API version remains **1**. Existing clients remain supported.
- Existing installs on the `release` branch update normally: this release
  fast-forwards from that branch, and the checkout is then at the `v1.7.0` tag.
  The `release` branch receives no further updates after this release.
- Coolify operators should switch the Branch field from `release` to a release
  tag after upgrading.
