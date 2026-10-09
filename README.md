# Aulora

Aulora is team chat you run on your own server. One server hosts one workspace with channels, direct messages, threads, reactions, file sharing, roles, and voice/video calls. Connect from a browser, the desktop app, or the mobile app. Each client can join multiple servers.

Personal and noncommercial use is free under the [PolyForm Noncommercial License 1.0.0](LICENSE). Businesses must purchase a [commercial license](COMMERCIAL.md). Email [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev) for licensing. Aulora is source-available, not OSI open source.

Messages and uploads use server-side encryption. The server decrypts content for authorized users, so the server operator must be trusted. This is not end-to-end encryption. Keep the encryption key backed up separately from the database.

## Choose your starting point

| I want to... | Start here |
| --- | --- |
| Join an existing workspace | [User guide](apps/docs/content/user-guide.md) |
| Run my own server | [Quick start](#run-your-own-server), then [self-hosting](apps/docs/content/self-hosting.md) |
| Deploy with Coolify | [Coolify guide](apps/docs/content/coolify.md) |
| Configure accounts, roles, or invitations | [Admin guide](apps/docs/content/admin.md) |
| Back up or upgrade a server | [Backups and restore](apps/docs/content/backups.md), [updates](apps/docs/content/updates.md) |
| Build or contribute | [Development setup](docs/development.md), [contributing](CONTRIBUTING.md) |
| Prepare a release | [Release checklist](docs/releasing.md) |

## Run your own server

Install Git and Docker with Compose v2.24 or newer. Docker must be running. You do not need Bun, Node.js, or Rust to run the server. The first install downloads images and builds the app, which can take several minutes.

On macOS, Linux, or WSL:

```sh
git clone https://github.com/chark1es/Aulora.git
cd Aulora
./install.sh
```

On Windows, use PowerShell 7 and Docker Desktop with Linux containers:

```powershell
git clone https://github.com/chark1es/Aulora.git
Set-Location Aulora
pwsh ./install.ps1
```

Enter an owner email and a password with at least 16 characters when prompted. Open the URL printed by the installer, normally <http://localhost:8080>, and sign in with that account. The installer creates the workspace and saves configuration and generated secrets in `infra/docker/.env`. Re-running it reuses that configuration.

The default addresses are for a local trial. For phones, other computers, or a public server, configure reachable URLs and HTTPS using the [self-hosting guide](apps/docs/content/self-hosting.md). Replace the database and object-storage example passwords before a public deployment. A domain passed to the installer does not configure DNS or TLS for you.

After setup, create a channel and send a message. Use Workspace settings to invite a second user and configure signup policy. Back up `.env` securely, including `AULORA_ENCRYPTION_KEY`, then set up [off-machine backups](apps/docs/content/backups.md).

Kanban and Notes are optional addons, off by default and enabled in **Workspace settings → Addons** by a member with the Manage workspace permission. They ship in the web and setup images and use the same backend, so an upgrade rebuilds both images and re-runs `setup` before recreating `web`. See the [Kanban](apps/docs/content/kanban.md) and [Notes](apps/docs/content/notes.md) guides.

## Get the clients

Use your server's web URL in a browser. Desktop installers and Android APKs are distributed through [GitHub Releases](https://github.com/chark1es/Aulora/releases) when a release is published. Choose the file for your operating system and CPU. The [user guide](apps/docs/content/user-guide.md) explains installation, sign-in, and notifications.

iOS release IPAs are for App Store Connect/TestFlight distribution, not direct installation on arbitrary iPhones. Store availability and live notification delivery must be confirmed for each release. Windows installers are currently unsigned and can display an unknown-publisher warning. Optional mobile push requires a configured relay; chat works without it.

## Build from source

Use Bun 1.4.0 and Node.js 22.18.0, the versions pinned in CI, plus Git:

```sh
bun install --frozen-lockfile
bun run check
```

`check` runs lint, type checks, tests, web/docs builds, infrastructure and release-script tests, and documentation checks. Native builds require platform SDKs and run separately in CI. Follow [development setup](docs/development.md) to start a working frontend and backend. `bun run dev` alone does not provision a server.

Build and read the documentation locally:

```sh
bun run docs:dev
# http://localhost:4173
```

The site is static: the landing page at the root and the docs under `docs/`. Host `apps/docs/dist` after `bun run docs:build`. It does not require an Aulora account or backend.

## Repository map

| Directory | Contents |
| --- | --- |
| `apps/web` | React web client and desktop frontend |
| `apps/desktop` | Tauri shell for macOS, Windows, and Linux |
| `apps/mobile` | Expo/React Native iOS and Android client |
| `apps/docs` | Public documentation site |
| `packages/convex` | Backend, authentication, permissions, encryption, and schema |
| `packages/core` | Shared client logic |
| `packages/tokens`, `packages/ui-*`, `packages/avatars` | Shared UI packages |
| `infra/docker` | Server deployment, setup, updates, and backups |
| `infra/push-relay` | Optional APNs/FCM/UnifiedPush relay |
| `docs` | Contributor guides, release procedures, and historical engineering reports |
| `spikes` | Experiments, excluded from the supported deployment |

## Support and security

Use [GitHub Issues](https://github.com/chark1es/Aulora/issues) for reproducible bugs and feature requests. See [troubleshooting](apps/docs/content/troubleshooting.md) before filing a setup issue. Include versions and redacted logs.

Report vulnerabilities privately to [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev). Read [SECURITY.md](SECURITY.md) for reporting details and the trust model. Do not publish credentials, encryption keys, or private messages in issues.

[Releases](https://github.com/chark1es/Aulora/releases) · [License](LICENSE) · [Commercial licensing](COMMERCIAL.md) · [Third-party software](THIRD_PARTY_NOTICES.md) · [Privacy](apps/docs/content/privacy.md)

## Company subscriptions

Company subscriptions cost **$1 per monthly active user**. Read the [commercial terms](COMMERCIAL.md) for billing and permitted deployments, or the [licensing guide](apps/docs/content/licensing.md) to activate a server and view usage.
