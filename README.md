# Aulora

Aulora (pronounced aw-LOR-uh) is self-hosted, end-to-end encrypted team chat: one
`docker compose up` gives your team one workspace with channels, DMs, threads,
reactions, uploads, roles, and live updates, and five clients (web, macOS/Windows/Linux
desktop, iOS, Android) can each join many servers. Every message, reaction, edit and
file is encrypted on the sender's device with MLS (RFC 9420); the server stores
ciphertext and metadata only. The reference look is a near-black canvas with a faint
dot grid, soft rounded cards, a warm ember accent and a moss secondary.

Aulora is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE)
for personal, charity, school, research, public-safety and government use. Companies
and for-profit teams need the paid commercial license ([COMMERCIAL.md](COMMERCIAL.md))
— both files arrive in a later phase. This is not OSI open source.

## Prerequisites

| Tool | Version |
| --- | --- |
| [Bun](https://bun.sh) | 1.4.0 (pinned via `packageManager`) |
| [Node.js](https://nodejs.org) | 22.18.0 |
| Git | any recent version |
| Docker + Compose | only needed for the self-hosted stack, from a later phase |

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
apps/      web (Vite SPA), desktop (Tauri), mobile (Expo) — later phases
packages/  config, tokens, core (this phase); convex, crypto, ui-*, avatars — later
infra/     docker-compose, Caddyfile, push-relay — later phases
spikes/    Phase 0 proofs (kept for reference)
```

This phase ships the shared foundation only: `@aulora/config` (strict TS bases and the
Biome preset), `@aulora/tokens` (the one source of truth for colors, radii, spacing and
type, with Tailwind and NativeWind presets), and `@aulora/core` (server URL handling,
well-known validation, permission bitfield, unread math, profile stores).