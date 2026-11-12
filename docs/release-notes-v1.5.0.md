## Aulora 1.5.0

**Mentions, call add-ons and a shared visual language.** This release adds
`@everyone` and `@here` broadcast mentions, role colors, the Inter and
JetBrains Mono typefaces, a keyboard-safe mobile layout, detailed audit events,
local debug reports, and optional call transcription, guest invites and
scheduled calls.

**Also in this release**

- Broadcast mentions respect channel permissions, private channels, DMs,
  threads and notification preferences. `@here` reaches online members only,
  and mass mentions can be suppressed without hiding badges.
- Every desktop, web and mobile client now shares Inter and JetBrains Mono, with
  consistent text, form, dialog and menu primitives.
- Mobile sheets and the composer stay clear of the keyboard and system insets.
- Audit log entries open a readable detail dialog with actor, target, time and
  metadata.
- Web and desktop can open **Debug logs** from the context menu, including on
  connect and sign-in screens, and export a capped local report. Nothing uploads
  automatically.
- The optional transcription add-on streams each participant's own microphone to
  the self-hosted `transcriber`, with speaker attribution, an opt-out notice and
  encrypted write-only summary credentials. Guest calls use expiring, revocable,
  use-capped links and a lobby; guests never receive a workspace account.
  Scheduled calls can open before they start and use the viewer's local time
  zone.

### Upgrade notes

- Schema changes are additive and optional, and discovery `API_VERSION` remains
  `1`. No manual backfill is required. Member-role and attachment-scope backfills
  run automatically in bounded batches after the upgrade; until a legacy
  attachment is reached, its uploader is the only reader.
- No minimum or recommended client version is raised. Older clients keep
  working against this backend, and this client works against an older backend
  that lacks the new capabilities.
- Transcription is off until an operator enables the add-on, runs `setup` to
  generate `TRANSCRIBER_TOKEN`, starts the stack with
  `--profile transcription`, and downloads a model. Without that profile the
  add-on reports that the service is not installed. Guest and scheduled calls
  need no additional container.
- Historical messages are not backfilled with `@everyone`/`@here` markers, so
  older rows continue to render as plain text. This is intentional: the database
  has no historical permission snapshot that could prove the author could send a
  broadcast at the time.

### Known limitations

- Broadcast delivery is at least once within the 24-hour replay window, not
  exactly once. A crash after a provider accepts a wake, or a partial
  multi-device failure, can repeat a wake. Large broadcasts are paged; if a page
  exhausts its retries, recipients on later pages are not reached.
- Clients older than 1.5.0 still lose a broadcast highlight when the visible
  audience exceeds 100 members. Current clients derive the highlight from the
  marker. Large thread mention fan-out can take a moment to appear in the
  thread inbox, and the legacy inbox still has its bounded candidate window.
- Deleting a message redacts it but does not revoke its attachment bytes;
  channel-authorized users can still access those files.
- Debug reports are local to the session, capped at 200 entries and 256 KiB, and
  do not capture native OS crashes or survive a restart.
- Transcription follows Whisper's per-window language detection, so a call that
  mixes languages can switch languages. Native mobile screens for the new call
  add-ons, recurring scheduled calls and guest screen sharing are not included.
- Windows installers remain unsigned. The iOS IPA is an App Store/TestFlight
  submission, so mobile store availability still depends on review.

### Verification notes

`bun install --frozen-lockfile`, `bun run check`, the desktop configuration
check and the remaining local release checks pass for this version. Signed
desktop, Android and iOS builds are produced by the GitHub Actions release
pipeline. This preparation did not run a live fresh-stack install, a populated
or skipped-version upgrade, a populated index build, a busy-channel load test, a
backup/restore, a real transcription or guest-call session over TURN, a provider
sign-in round trip, or an install on signed physical devices. Those remain
manual acceptance checks in `docs/releasing.md`.

See [Releases and client compatibility](releases.md) for the full rollout and
compatibility details.

**Full Changelog**: https://github.com/chark1es/Aulora/compare/v1.4.1...v1.5.0
