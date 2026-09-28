# Aulora

Aulora (pronounced aw-LOR-uh) is self-hosted team chat with server-side
encryption: one `docker compose up` gives your team one workspace with channels,
DMs, threads, reactions, uploads, roles, and live updates, and five clients
(web, macOS/Windows/Linux desktop, iOS, Android) can each join many servers. The
server seals every message, reaction, edit and file with AES-256-GCM envelope
encryption using a locally generated master key (`AULORA_ENCRYPTION_KEY`),
decrypting for authorized clients; external key managers (Vault, AWS KMS, GCP KMS
or an HTTP proxy) are an optional upgrade. The reference look is a near-black
canvas with a faint dot grid, soft rounded cards, a warm ember accent and a moss
secondary.

Aulora is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE)
for personal, charity, school, research, public-safety and government use. Companies
and for-profit teams need the paid commercial license ([COMMERCIAL.md](COMMERCIAL.md)).
Contributors sign the [CLA](CLA.md) (see [CONTRIBUTING.md](CONTRIBUTING.md)); this is
not OSI open source.

## Self-hosting

One command installs the stack. It checks Docker, writes `.env`, then builds and
runs the Compose stack and first-run setup for you:

```sh
./install.sh            # macOS / Linux (bash)
pwsh ./install.ps1      # Windows (PowerShell)
```

The full operator guides live in the docs site (`apps/docs`) and in
[infra/docker/README.md](infra/docker/README.md). To deploy on Coolify, use
[infra/docker/docker-compose.coolify.yml](infra/docker/docker-compose.coolify.yml)
and follow the guide in [apps/docs/content/coolify.md](apps/docs/content/coolify.md).

## Prerequisites

| Tool | Version |
| --- | --- |
| [Bun](https://bun.sh) | 1.4.0 (pinned via `packageManager`) |
| [Node.js](https://nodejs.org) | 22.18.0 |
| Git | any recent version |
| Docker + Compose | for the self-hosted stack (the installer needs only this) |

## Getting started

```sh
bun install        # install all workspaces, writes the single root bun.lock
bun run typecheck  # strict tsc --noEmit across every package
bun run lint       # Biome check across every package
bun run test       # Vitest suites across every package
```

Other root scripts: `bun run build` (Turborepo, emits `dist/**` where a package has a
build), `bun run dev`, `bun run format`, `bun run clean`.

## Layout

```
apps/      web (Vite SPA), docs (static site), desktop (Tauri), mobile (Expo)
packages/  config, tokens, core, convex, ui-web, ui-native, avatars
infra/     docker-compose + setup + backup runner, push-relay
docs/      phase gate reports
spikes/    Phase 0 proofs (kept for reference)
```

Phase 6 completes the beta surface: the instance admin panel (auth providers,
storage quotas, backups, push relay), a license status screen, nightly backups
(`convex export` + Postgres dump to S3), a docs site, and the one-command
installer. Everything runs on your own infrastructure; the only outside
dependency remains the optional project push relay for store-built mobile apps.