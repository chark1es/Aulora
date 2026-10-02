# Project audit and mobile parity

Audited October 1, 2026. This is the current record of feature coverage, verified changes, and remaining acceptance work. Old phase reports and plans live in [the archive](archive/README.md). Publication requirements remain in [the release checklist](releasing.md).

## Repository findings

The initial `bun run check` passed. Source searches found no active TODO/FIXME markers or unimplemented runtime stubs. An unused no-op factory for the removed MLS engine was deleted. Historical reports contained removed MLS requirements and outdated release claims. Seventeen records were moved to `docs/archive`, including the original plan, and two identical reload handoffs were consolidated. The documentation map lists all current maintainer guides. Link checks now discover current Markdown files instead of relying on a hand-maintained list.

Two backend lint diagnostics were also corrected by capturing a validated license ID before query callbacks and using a template string for the report URL. The documentation stylesheets still produce 19 nonblocking lint warnings about selector order and reduced-motion overrides. Those warnings are recorded here; a passing check is not a warning-free claim.

The pre-existing, untracked App Review notes were preserved. They are a submission template, with a deliberately unspecified reviewer server and credentials. Phase 0 spike reports and logo explorations remain under `spikes/`, explicitly marked as throwaway records and excluded from the application workspace. Release checklists and submission templates are operational documents, not finished-release claims. Legal, licensing, contributor, security, support, and third-party attribution files remain active.

A fresh debug iOS build initially failed with missing React Native debug symbols. The local Pods folder contained a stale release framework. Restoring the matching debug framework and installing the updated Pods produced a successful build. This was a generated local dependency problem; the application linker configuration needed no workaround.

## Desktop to mobile coverage

Desktop uses the web client inside Tauri. The comparison follows `apps/web/src/components/chat`, mobile chat components, and their shared chat/backend APIs.

| Everyday feature | Mobile coverage |
| --- | --- |
| Server connection, local/OIDC sign-in, multiple workspaces, invite deep links | Existing native flows retained |
| Channels, DMs, group messages | Existing conversations plus a new people picker for starting DMs and groups; conversation titles use member names |
| Rich text, user/role/channel mentions, quoted replies | Existing rendering/autocomplete plus inline quoted replies |
| Threads and threads inbox | Existing inbox and replies; thread messages now use the same actions and reactions as the main conversation |
| Reactions, copying, editing, deletion | Existing reactions plus a reaction entry control, copy, edit, and confirmed deletion; permissions remain server enforced |
| Pins | New paginated pin list and navigation to history outside the live message window; thread pins resolve to their root |
| Search | New searchable conversation list and message results. On mobile and desktop, a search shows matches from history already on the device, then reads older history into the on-device index until every readable conversation and thread is covered; the query never leaves the device |
| Message history and unread | New earlier-history pagination; the unread control now scrolls to the unread row |
| Camera, photos, documents, clipboard attachments | Existing upload paths retained; images can be previewed, audio and video play inline, and files are saved/opened with the native share sheet |
| Profiles, presence, custom status, private notes | Avatar controls and status retained; nickname/bio editing and public member profiles added; offline members are included |
| Offline sends | Queue survives process restarts, is isolated by server/account, retries in the foreground, and offers retry/discard after failures; permission errors are shown instead of queued |
| Voice/video, device settings, sound settings | Existing native WebRTC and audio controls retained |
| Muting/hiding channels, moderation | Existing controls retained; channel/category permission overrides now gate message actions |
| Notifications | Existing APNs/FCM and local notifications retained; sign-out revokes this session's registered push device before ending the session |

Workspace/instance administration, role/override editors, audit logs, licensing, backups, server update controls, and deployment settings remain desktop/web tasks. Native desktop menus, tray, updater, drag/drop, and keyboard shortcuts have platform-specific equivalents rather than mobile copies. Store distribution supplies mobile application updates.

## Apple design review

The mobile client uses Expo and React Native on iOS and Android. Its job is to help workspace members read conversations, respond, and call. Generated avatars identify people; Ember marks actions while neutral surfaces keep messages readable. Existing shared icons remain consistent across clients.

### Accessibility

Shared buttons and icon buttons now have 48-point touch targets. Inputs use a minimum height rather than a fixed height, so text can grow with system settings. Native body text is 17 points, supporting text is 15, and metadata is 13. Names wrap in message headers. Message text follows the full system text scale. Navigation labels cap growth at 1.5 times, and button labels and composer text cap it at twice their base size to preserve usable controls. At accessibility sizes, the composer uses a labeled send icon and the demo uses a compact toolbar. Administrator-selected role colors remain on avatar rings instead of replacing readable name text.

The native palette has separate accessible dark foreground/button colors. Dark Ember text is `#FF9B68`, with `#1C1C1E` button labels. The worst Ember text contrast, on `#3A3A3C`, is 5.48:1; dark primary button labels are 8.22:1. Muted text is at least 4.69:1 across native surfaces. The contrast test checks text, muted text, accent, success, and error colors across both appearances and verifies both filled button label colors at 4.5:1 or higher.

Reference: [Accessibility, Vision](https://developer.apple.com/design/human-interface-guidelines/accessibility), "Support larger text sizes." [Typography, Supporting Dynamic Type](https://developer.apple.com/design/human-interface-guidelines/typography) informs the growing layouts and system text scaling.

### Navigation and presentation

The signed-in surface is three full-screen panes moved by a horizontal swipe: the hub on the left, the conversation in the middle, and its members on the right. The hub carries three floating controls at thumb height: a tab bar (Channels, DMs, You), the workspace switcher on its own at the leading end because it opens a sheet rather than a section, and search on its own at the trailing end. Settings live in You, and search focuses its field directly above the controls. The hub opens on the workspace name, its host, and the people who are online. The Channels tab leads with the three most recently active threads the viewer is part of, with a link to the full list, so missed replies are the first thing seen. A reply shows as one line above the message, tied to its avatar by a connector, matching the web client; tapping it jumps to the original. Tapping or long-pressing a message opens its actions. Conversation toolbar buttons mirror both swipes. A thread opens as a page over the conversation and closes with a swipe or Back. Menus and pickers (message actions, attachments, channel actions, member profile, moderation, pins, workspaces) are content-sized bottom sheets with a dimmed backdrop, a close button, drag and Android Back dismissal. Forms with several fields (create or edit channel, new message, private note) keep native iOS page-sheet presentation with Cancel on the leading edge; view-only page sheets (bans, image preview) close with Done on the trailing edge. All page sheets support swipe dismissal, keyboard avoidance, and reduced-motion handling. Sheet roots receive theme variables, including inside native modal presentation.

Reference: [Tab bars, Best practices](https://developer.apple.com/design/human-interface-guidelines/tab-bars), "Use a tab bar to support navigation, not to provide actions." [Sheets, Mobile](https://developer.apple.com/design/human-interface-guidelines/sheets), "Support swiping to dismiss a sheet."

### Appearance and craft

The app follows system light/dark appearance. The router background now uses the active palette. Obsolete hard-coded CSS fallback colors were removed. The encryption implementation label was removed from the conversation toolbar; channel topics and pins now occupy that space. Quick-reaction suggestions on every message were removed to give content more room; reactions remain in message actions and existing reaction chips.

Reference: [Dark Mode, Best practices](https://developer.apple.com/design/human-interface-guidelines/dark-mode), "Avoid offering an app-specific appearance setting." [Motion, Best practices](https://developer.apple.com/design/human-interface-guidelines/motion), "Make motion optional." Layout, color, designing for iOS, searching, and text-field references were also read for this review.

## Verification and remaining work

`bun run check` passes, including lint, TypeScript, all nine workspace test suites, web/docs builds, infrastructure and release script tests, documentation links, and release metadata checks. Mobile has 48 passing tests, backend 328, and native UI 10. New regression tests cover persistent offline storage and account isolation, reply metadata on retries, private-channel creation failures, old message context permissions, and light/dark contrast. Later tests cover archive search paging, thread replies, deleted messages, unreadable channels and connection failures in the shared index, the desktop search progress states, and desktop audio/video attachment playback.

Both iOS and Android JavaScript/assets exports pass. A fresh unsigned iOS simulator debug build passes and was installed on an iPhone 17e running iOS 26.5. The offline demo exercised shared chat controls, native message-sheet presentation, reactions, and editing a thread reply. The edited text appeared in the thread after saving. A text attachment opened the native share sheet with Copy and Save to Files actions. Light/dark appearance and the largest accessibility text size were inspected; the large-text demo toolbar was corrected after it pushed chat offscreen. The unsigned simulator also logged an Expo Notifications keychain-access warning at startup; it was dismissed to test local UI and still requires validation in a signed device build. These checks used local demo data. They do not certify the new authenticated workflows, installed release behavior, or physical-device notifications.

Archive search and inline audio/video playback were added after that simulator session. Mobile video uses `expo-video`, a new native module: the iOS pods and both JavaScript exports were regenerated, and an unsigned simulator build was run to confirm it links. Neither feature has been exercised against a real server or on a device.

Remaining acceptance work:

- Physical-device push delivery and taps, denied permissions, foreground/background behavior, sign-out, and workspace switching. Simulator token registration cannot prove APNs or FCM delivery.
- Two-device voice/video calls, restrictive networks requiring TURN, Bluetooth/audio routes, and screen-sharing behavior.
- Signed macOS/Windows/Linux/Android/iOS release installation and the store/release requirements in the release checklist. The existing checklist also tracks account-deletion requirements and store disclosures.
- Archive search against a large workspace, including opening results in old history and threads, and audio/video attachment playback on iOS and Android, during a call, and with the silent switch on.
- Android and tablet UI acceptance, VoiceOver/TalkBack interaction, increased contrast, and the largest supported accessibility text settings across every authenticated workflow.

Product limitations to keep explicit:

- Search stays on the device because the server stores message text sealed and keeps no search index. Covering the complete archive means reading it page by page during a search, so the first search of a session in a large workspace keeps adding older results until it finishes. The mobile index is kept in memory and rebuilt each session; the desktop index persists.
- Audio and video attachments are downloaded in full before they play; there is no streaming. Other non-image files are saved or opened through the native share sheet on mobile and downloaded on desktop.
- Workspace administration remains on desktop/web. The mobile client is for everyday communication and existing member moderation.
