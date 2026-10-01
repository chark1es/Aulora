# Aulora 1.0.0

Initial v1 distribution. Physical-device testing and mobile store availability remain separate from these downloads.

Aulora is self-hosted team chat with channels, direct messages, threads, reactions, file sharing, roles, and voice/video calls. One server hosts one workspace, and each client can join multiple servers.

Start with the [README](https://github.com/chark1es/Aulora/blob/v1.0.0/README.md) to install a server or choose a client. The [user guide](https://github.com/chark1es/Aulora/blob/v1.0.0/apps/docs/content/user-guide.md) explains connecting, sign-in, notifications, and calls.

## Licensing

Personal and noncommercial use is free under the [PolyForm Noncommercial License 1.0.0](https://github.com/chark1es/Aulora/blob/v1.0.0/LICENSE). Business use requires a paid commercial agreement. Email [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev) for a quote. License and third-party notice files accompany the release.

## Downloads

Choose the macOS DMG for your CPU, the Windows x64 installer, the Linux AppImage or Debian package, or the Android APK. Web/docs ZIPs are static builds; they do not include a running backend. Android AABs and iOS IPAs are store-submission artifacts.

Verify downloads against `SHA256SUMS`. Windows installers are unsigned and can display an unknown-publisher warning. Linux in-app updates use the AppImage; Debian packages need manual replacement.

The [release assets](https://github.com/chark1es/Aulora/releases/tag/v1.0.0) contain the downloads. Mobile store and TestFlight access are not yet available. An IPA downloaded from GitHub cannot be installed on an arbitrary iPhone. See the [mobile test plan](https://github.com/chark1es/Aulora/blob/main/docs/mobile-testing.md).

Testers connect to their own server. On a fresh iOS installation, a reserved server address opens a clearly labeled offline App Review demo. Sample channels, messages, threads, reactions, search, members, and local files stay on the device and reset on exit. Calls, authentication, administration, and push still require a real server. See [review instructions](https://github.com/chark1es/Aulora/blob/main/docs/apple-review-demo.md).

## Deployment notes

The Docker defaults are for a local trial. Public deployments need HTTPS, reachable origin settings, non-default database/storage passwords, and private administration ports. Follow [self-hosting](https://github.com/chark1es/Aulora/blob/v1.0.0/apps/docs/content/self-hosting.md) or [Coolify](https://github.com/chark1es/Aulora/blob/v1.0.0/apps/docs/content/coolify.md).

Encryption is server-side. Operators must be trusted and must keep the original encryption key backed up separately. Follow [backups and restore](https://github.com/chark1es/Aulora/blob/v1.0.0/apps/docs/content/backups.md) and test recovery, including uploaded files.

Mobile background notifications require a configured relay. Voice/video across restrictive networks may require TURN. Desktop local notifications require the process to remain running.

## Existing installations

Read [updates](https://github.com/chark1es/Aulora/blob/v1.0.0/apps/docs/content/updates.md), back up data and the encryption key, and verify the deployment after updating. No dedicated v1 schema migration is supplied. Verify restore and compatibility against your deployment before updating.

Report reproducible bugs through GitHub Issues. Report vulnerabilities privately to [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev).

## Verification limits

Native CI compilation passes for macOS, Windows, Linux, Android, and the iOS simulator. Signed build and checksum validation run before GitHub publication. Physical-device behavior, production OAuth/HTTPS/WSS, TURN calls, and background push delivery have not completed the release acceptance pass. Native license inventories and project asset ownership still require publisher review. The repository checklist records these outstanding checks; the release does not certify them.

The Linux desktop dependency graph includes `glib` 0.18.5, affected by the moderate [VariantStrIter advisory](https://github.com/advisories/GHSA-wrw7-89jp-8q8g). The dependency alert remains open. Upgrading this GTK dependency requires coordination with the desktop framework; this release does not claim the issue is fixed.
