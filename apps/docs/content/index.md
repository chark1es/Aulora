# Aulora docs

Aulora is self-hosted team chat with server-side encryption: one server is one
workspace, the server encrypts every message, reaction, edit and file with
AES-256-GCM envelope encryption using a locally generated master key
(`AULORA_ENCRYPTION_KEY`), and the master key (the KEK) is never stored in the
database. External key managers (Vault, AWS KMS, GCP KMS or an HTTP proxy) are
an optional upgrade for key custody.

- [Getting started](getting-started.md) — run it locally, or self-host it.
- [Self-hosting](self-hosting.md) — the one-command installer and the stack.
- [Admin panel](admin.md) — auth providers, storage quotas, push relay, license.
- [Backups](backups.md) — nightly `convex export` + Postgres dump to S3.
- [Licensing](licensing.md) — PolyForm Noncommercial and commercial use.
- [Contributing](contributing.md) — workflow and the CLA.

## What one server gives you

Channels, DMs, group DMs, threads, reactions, server-encrypted uploads, full history,
Discord-style roles with per-channel overrides, server-side search, live updates, and
five clients (web, macOS/Windows/Linux desktop, iOS, Android) that can each
join many servers.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Docker + Compose | recent | self-hosting |
| Bun | 1.4.0 | building from source |
| Node.js | 22.18.0 | building from source |
| Git | any | building from source |
