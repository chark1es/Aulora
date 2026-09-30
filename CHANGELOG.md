# Changelog

Release notes describe user-facing changes. Published versions and downloads are listed in [GitHub Releases](https://github.com/chark1es/Aulora/releases).

## Monthly commercial activity billing

- Count distinct logged-in/present/message-sending members once per UTC month after license activation, and deliver aggregate reports without member identities or message content.
- Charge full months for active users; prorate only partial license coverage. Monthly plans replace the proposed annual offering.
- Require enterprise forks to retain licensing and reporting, and clarify contributor ownership and employer authorization in the separate CLA.

## Contribution tracking

- Record CLA acceptance through a pull request bot, including co-authors, with an archived agreement and acceptance records for each agreement hash.
- Keep commercial terms, contributor grants, and development instructions in their respective documents, with links from the public guides.

## 1.0.0 release candidate

This section describes the intended v1 release. It does not claim that binaries, store listings, or production verification have been published. Follow [the release checklist](docs/releasing.md) before publishing.

- Self-hosted workspaces with channels, direct and group messages, threads, reactions, pinned messages, search, and file uploads.
- Roles, channel overrides, invitations, member moderation, workspace settings, and instance administration.
- Server-side content encryption with a local master key and optional external key managers.
- Voice and video calls using WebRTC, with configurable STUN/TURN servers.
- Browser, Tauri desktop, and Expo/React Native mobile clients with support for multiple servers.
- Local sign-in, OAuth/OIDC options, and optional push delivery.
- Docker and Coolify deployment, nightly backups, server update controls, and signed desktop updater artifacts.
- Public user, operator, contributor, privacy, security, licensing, and release documentation.

Initial distribution uses unsigned Windows installers, macOS direct downloads, Linux AppImage/Debian packages, and Android APK/AAB builds. iOS IPAs require App Store Connect/TestFlight distribution. Store approval and push delivery are separate release checks.
