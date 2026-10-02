# Aulora documentation

Aulora is self-hosted team chat. Each server hosts one workspace; clients can join several servers. Personal and noncommercial use is free. Businesses need a paid commercial agreement.

## Start here

- Installing the app? Read [install a client](getting-started.md#install-a-client), then the [user guide](user-guide.md#install-a-desktop-or-mobile-client).
- Running a server? Start with [install a workspace](getting-started.md#install-a-workspace).
- Deploying publicly? Read [self-hosting](self-hosting.md) or [Coolify](coolify.md).
- Managing a workspace? Read the [admin guide](admin.md).
- Keeping it running? Set up [backups](backups.md), [updates](updates.md), and read [troubleshooting](troubleshooting.md).
- Building from source? Read [contributing](contributing.md) and the [development guide](https://github.com/chark1es/Aulora/blob/main/docs/development.md).

## What Aulora provides

Channels, direct and group messages, threads, reactions, file sharing, search, permissions, and voice/video calls. Browser, desktop, and mobile clients connect to the same server.

Content encryption happens on the server. The operator can decrypt content for authorized users. This is not end-to-end encryption. See [privacy](privacy.md) for the trust model and optional external services.

## Requirements

| Task | Requirements |
| --- | --- |
| Join a workspace | A server URL, an account or invitation, and a supported client |
| Run a server | Git, Docker, and Compose v2.24 or newer |
| Build JavaScript apps | Bun 1.4.0 and Node.js 22.18.0 |
| Build native clients | Platform SDKs, plus Rust for desktop |

Release binaries and store listings become available when published. A successful source build does not establish store availability or live push delivery.

[Licensing](licensing.md) explains free and paid use. Contact [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev) for commercial licensing or private security reports.
