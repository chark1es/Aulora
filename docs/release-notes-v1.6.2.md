## Aulora 1.6.2

### Fixes

- Fix desktop add-on menu clicks being lost on macOS WebKit before Kanban,
  Notes, Scheduled calls or Transcripts can open.
- Remove the left selection bar from desktop and mobile channel/conversation
  rows. The selected background and accessible selection state remain.
- Center the mobile session-loading spinner and status text inside scrollable
  screens, including the workspace membership check.
- Show a single `@` prefix in role color mention previews, including `@everyone`.
- Start the transcriber with the stack on ordinary Docker Compose and Coolify
  installs, and during installer/deploy/staged-update flows. Model weights are
  not downloaded at startup; an authorized user must request a download in
  Workspace settings. Restarts can restore previously downloaded weights.
- Pass the release automation credential to the release-branch promotion
  workflow so publication can be followed by its checked promotion PR.

### Upgrade notes

- No schema migration, discovery API change or minimum-client increase is
  required. Discovery API version remains **1**. Existing clients remain supported.
- Update desktop/mobile applications for their client fixes. Web users receive
  the shared UI fixes after their server deploys this release and they reload.
- The transcriber now starts without a Compose profile, retaining its existing
  network isolation, non-root user and read-only filesystem. Update using the
  installer/deploy helper or staged updater so the service receives the shared
  token from setup. A manual service start is
  `docker compose up -d --build transcriber` after setup has completed.
- Enabling transcription and downloading a speech model remain separate owner
  choices. Installing this release alone does not start call transcription.
- This release also includes the OTA pipeline introduced after 1.6.1: mobile OTA
  requires an Expo project configured for the native build, a production channel
  and a publishing token. Earlier mobile binaries still need a full update first.
  Desktop continues to receive signed packages, with a shared frontend build.
- Deploy/update order remains backend setup before the web container. A failed
  required setup retains the previous frontend; existing update retry and
  web-only rollback limits still apply. No model-volume deletion is required
  for rollback. Desktop updater rollout remains 100% unless explicitly configured.

### Validation and limitations

- Automated regression coverage exercises the WebKit blur/click sequence for
  every add-on, role mention prefixes, mobile layout rules, default transcriber
  startup and setup ordering, staged-update retry/image checks, and cached-only
  model loading.
- Web/mobile typechecks, web build, desktop frontend budget, documentation and
  release checks passed locally. Signed native artifacts are built by CI before
  publication.
- Native visual checks, a live Docker/Coolify deployment, populated/skipped-version
  upgrades and on-device OTA/rollback were not verified locally. The transcriber
  tests use synthetic loaders, not a downloaded speech model.
- Windows installers remain unsigned. Store distribution remains subject to
  the existing upload and approval process.
