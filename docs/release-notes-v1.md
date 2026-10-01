# Aulora 1.0.0

Release-notes draft. Publish only after the [release checklist](releasing.md) is complete.

Aulora is self-hosted team chat with channels, direct messages, threads, reactions, file sharing, roles, and voice/video calls. One server hosts one workspace, and each client can join multiple servers.

Start with the [README](../README.md) to install a server or choose a client. The [user guide](../apps/docs/content/user-guide.md) explains connecting, sign-in, notifications, and calls.

## Licensing

Personal and noncommercial use is free under the [PolyForm Noncommercial License 1.0.0](../LICENSE). Business use requires a paid commercial agreement. Email [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev) for a quote. License and third-party notice files accompany the release.

## Downloads

Choose the macOS DMG for your CPU, the Windows x64 installer, the Linux AppImage or Debian package, or the Android APK. Web/docs ZIPs are static builds; they do not include a running backend. Android AABs and iOS IPAs are store-submission artifacts.

Verify downloads against `SHA256SUMS`. Windows installers are unsigned and can display an unknown-publisher warning. Linux in-app updates use the AppImage; Debian packages need manual replacement.

Only include App Store, TestFlight, or Google Play links after they are live and verified. An IPA downloaded from GitHub cannot be installed on an arbitrary iPhone.

## Deployment notes

The Docker defaults are for a local trial. Public deployments need HTTPS, reachable origin settings, non-default database/storage passwords, and private administration ports. Follow [self-hosting](../apps/docs/content/self-hosting.md) or [Coolify](../apps/docs/content/coolify.md).

Encryption is server-side. Operators must be trusted and must keep the original encryption key backed up separately. Follow [backups and restore](../apps/docs/content/backups.md) and test recovery, including uploaded files.

Mobile background notifications require a configured relay. Voice/video across restrictive networks may require TURN. Desktop local notifications require the process to remain running.

## Existing installations

Read [updates](../apps/docs/content/updates.md), back up data and the encryption key, and verify the deployment after updating. Record any v1-specific schema migration instructions here before publication.

Report reproducible bugs through GitHub Issues. Report vulnerabilities privately to [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev).
