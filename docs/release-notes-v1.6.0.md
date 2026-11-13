## Aulora 1.6.0

This release improves navigation, workspace notifications and mobile calling,
and makes captured errors and warnings visible automatically.

### Changes

- Native sign-out supplies a valid request origin while preserving explicit
  caller headers and server origin validation.
- Android Back retraces visited screens and conversations. Nested editors,
  sheets and settings handle Back first, including unsaved-change confirmation.
- Workspace tools share one **Addons** navigation entry. Existing notes open in
  reading mode with an explicit edit action; saving preserves newer typing that
  arrives while a write is in flight.
- Workspace navigation shows unread activity from other saved workspaces.
  Mobile notification routing switches to the matching workspace and opens the
  message, including thread context, with retries for delayed profile readiness.
- Mobile media settings use dropdowns with native audio-route choices, active
  route feedback and saved-route retries. Android communication devices use the
  platform's output-device identifiers.
- Attachment and message-action entry points dismiss the keyboard. Mobile
  settings use consistent page transitions and nested Back handling.
- Voice channels show participants and ask before joining. Video joins enable
  the camera only after a successful join; failures appear on the pre-join page.
- Recently visited screens retain state within bounded caches and a 60-second
  hidden lifetime. Dirty Notes drafts are protected; unrelated hidden
  subscriptions expire, and confirmed discard resets the retained draft.
- Debug screens automatically list captured errors and warnings. The test-error
  button is removed. Handled auth, outbox and action failures are recorded with
  redaction and account-ownership guards that drop stale asynchronous failures.

### Upgrade notes

- Discovery API version remains **1**. Backend capability fields are additive;
  no new schema migration or manual backfill is required for these changes.
- No minimum or recommended client version is raised. Cross-workspace web badges
  require the server's new `workspaceUnread` capability; older servers are
  skipped. Mobile resolves configured relay server IDs through public config.
- Deploy backend functions and clients together using the documented update
  procedure. Keep the existing encryption key and a restorable backup; a
  client rollback does not roll back backend functions.

### Validation and limitations

- Source checks and desktop builds on macOS, Windows and Linux, plus Android and
  iOS compilation, passed for the integrated fixes before this version bump.
- Hardware Bluetooth routing, native gestures, live push/OAuth flows,
  two-device voice/video and populated deployment upgrade/recovery were not
  exercised in this environment. Compilation does not establish device behavior.
- No representative busy-workspace load benchmark was run. Retention and badge
  subscriptions have explicit caps; mobile badge counts remain process-local.
- First visits still fetch data. Debug history is a bounded in-memory buffer and
  cannot recover a native crash that terminates the process. Reports remain
  local until exported and should be reviewed before sharing.
- Windows installers remain unsigned. iOS distribution and mobile store
  availability depend on the separate signing and store approval processes.
