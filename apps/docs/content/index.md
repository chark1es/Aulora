# Aulora docs

Aulora is self-hosted, end-to-end encrypted team chat: one server is one
workspace, every message, reaction, edit and file is encrypted on the sender's
device with MLS (RFC 9420), and the server stores ciphertext and metadata only.

- [Getting started](getting-started.md) — run it locally, or self-host it.
- [Self-hosting](self-hosting.md) — the one-command installer and the stack.
- [Admin panel](admin.md) — auth providers, storage quotas, push relay, license.
- [Backups](backups.md) — nightly `convex export` + Postgres dump to S3.
- [Licensing](licensing.md) — PolyForm Noncommercial and commercial use.
- [Contributing](contributing.md) — workflow and the CLA.

## What one server gives you

Channels, DMs, group DMs, threads, reactions, encrypted uploads, full history,
Discord-style roles with per-channel overrides, local search, live updates, and
five clients (web, macOS/Windows/Linux desktop, iOS, Android) that can each
join many servers.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Docker + Compose | recent | self-hosting |
| Bun | 1.4.0 | building from source |
| Node.js | 22.18.0 | building from source |
| Git | any | building from source |
