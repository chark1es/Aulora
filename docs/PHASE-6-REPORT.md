# Phase 6 — Beta: Gate Report

Date: 2026-09-26. Scope: the instance admin panel, nightly backups, license
status, the docs site and the one-command installer. Companion to the Phase 4
and Phase 5 gate reports.

**Verdict: every Phase 6 surface is implemented and unit/integration tested on
an offline Windows host; steps that need live Docker images, cloud credentials
or a real outside tester are called out below.** Scope gate from `plan.md` is
*"Outside tester self-hosts without help"*: the installer, docs and admin
surfaces exist and are exercised by tests, but the full first-run cannot be
proven here without pulling the pinned images and a human tester.

## What shipped

- **Instance admin (`packages/convex` + `apps/web`)**
  - `instanceSettings` and `backups` tables; `instance.ts`, `license.ts` and
    `backups.ts` functions. Every function calls `requireInstanceAdmin`, which
    accepts only the owner account from setup — roles never grant instance
    authority. Secrets (OIDC client secret, `PUSH_RELAY_TOKEN`, `BACKUP_TOKEN`)
    are reported as booleans only.
  - The web console (owner-only "Instance admin" in the sidebar) with overview,
    auth providers, storage quotas, backups and push relay tabs, plus the
    license status screen and nag.
- **License status and files**
  - `LICENSE` (full PolyForm Noncommercial 1.0.0), `COMMERCIAL.md` stub,
    `CLA.md` and a CLA note in `CONTRIBUTING.md`.
  - `lib/license.ts` parses `AULORA1.<TIER>.<EXPIRY>.<ISSUED>.<LICENSEE>.<CHECK>`
    and reports unlicensed / active / expired / invalid. No DRM: enforcement is
    by the terms.
- **Nightly backups (`infra/docker/backup`)**
  - A `backups` compose profile service that waits for `setup`, mints the admin
    key with the backend's own `generate_key`, runs `pg_dump` + `convex export`
    at `BACKUP_HOUR_UTC`, uploads both to S3/MinIO, prunes local runs and records
    the result through `backups:record` (constant-time `BACKUP_TOKEN`).
  - The Convex cron records the nightly intent at `0 3 * * *` unless the operator
    disabled backups.
- **Docs site (`apps/docs`)**
  - A zero-dependency Markdown-to-HTML static build with the Aulora palette,
    covering getting started, self-hosting, admin, backups, licensing and
    contributing.
- **One-command installer (`install.sh`, `install.ps1`)**
  - Checks Docker, writes/reuses `infra/docker/.env`, builds and starts the
    stack, runs `setup`, optionally starts the backup profile and prints the URL.
    `--dry-run` / `-DryRun`, `--no-start` / `-NoStart` and `AULORA_*` overrides.

## Verified locally (Windows)

- `bun run test` — **460 Vitest tests pass** across 9 suites: convex **167**
  (+17), web **60** (+10), crypto 56, core 115, mobile 26, tokens 11, ui-web 11,
  ui-native 8, avatars 6.
- `bun run typecheck` — 10/10 tasks; `bun run lint` — 12/12.
- `node --test` in `apps/docs` — 6/6 (markdown renderer); in
  `infra/docker/backup` — 8/8 (backup plan); in `infra/docker/install` — 5/5 on
  Linux/macOS (skipped on Windows because the `bash` on PATH is WSL and does not
  share paths or environment).
- `docker compose --profile backups config --quiet` — the stack and backup
  service render without errors; both shell scripts pass `bash -n`.

## Not verified locally (needs live infra / credentials)

- A full `docker compose up -d --build` and first-run `setup` against the pinned
  images (this host did not pull them).
- The backup image build (apt + `mc` download) and a real S3/MinIO upload; the
  runner's `convex export`/`pg_dump` path against a live deployment.
- Real license issuance: keys are generated in-house for now, and there is no
  signing authority yet.
- An outside tester completing self-hosting unaided — the actual Phase 6 gate.

## What remains manual

- Buy/issue commercial licenses (pricing and the license text are still stubs),
  and check third-party license compatibility before a paid release.
- Set auth provider credentials and the public origin in `.env`, then re-run
  `setup`; the panel only reports what the environment exposes.
- Point the push relay at APNs/FCM credentials and verify live mobile delivery.
- Enable the `backups` profile and confirm the first upload to the operator's
  real S3 bucket; keep `infra/docker/.env` (especially `INSTANCE_SECRET`) safe.
- Trademark/domain checks and the Apple/Google store steps from `plan.md`.
