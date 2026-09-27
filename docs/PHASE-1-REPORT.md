> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phase 1 — Foundation: Gate Report

Date: 2026-09-26. Gate: **sign in on web from a fresh `docker compose up`.**

**Verdict: PASS** — independently reproduced by a separate verification agent on a
brand-new stack, from a clean checkout, using only the documented first-run steps.

## What shipped

- **Monorepo**: Bun workspaces + Turborepo + Biome + TypeScript strict. `packages/config` (shared tsconfig/Biome bases).
- **`packages/tokens`**: the exact Loam/Linen palette, radii, spacing and type scale as one source of truth, exported as Tailwind and NativeWind presets.
- **`packages/core`**: `normalizeServerUrl`, `fetchWellKnown`/`parseWellKnown` (rejects secret-shaped fields at any depth, never logs payloads), server-profile store, the full Discord-style `Permission` bitfield + `resolvePermissions` + `canModerate`, and unread math. 86 unit tests.
- **`packages/convex`**: full E2EE-aware schema; Better Auth mounted in Convex (`@convex-dev/better-auth` 0.12.5 + `better-auth` 1.6.15) with local email/password + TOTP, built-in GitHub/Google/Microsoft/Apple, and **generic OIDC** via discovery URL; OIDC group-claim → role hook; `server:publicConfig`; one-time `setup:initialize`; `requireAuth`/`requirePermission`; `convex-test` suites. 15 tests.
- **`packages/ui-web`** + **`packages/avatars`**: spec design primitives (pill buttons, 14/20px radii, dot grid, logo, particle spinner) and the pinned Blobatar (`blobatar@2.7.0`) wrapper seeded by stable id.
- **`apps/web`**: Vite + React 19 + TanStack Router + Tailwind v3.4 using the tokens presets; system/override theme; Discord-style server rail; server-connect screen; **sign-in driven entirely by the backend `auth` block**; Convex + Better Auth client with first-party cookies.
- **`infra/docker`**: proxy-agnostic Compose stack (`postgres:17`, `convex-backend`, `convex-dashboard`, `minio`, `web`, one-shot `setup`; optional `push-relay` profile); pinned images; `.env.example`; `web`/`setup` Dockerfiles; nginx `/api/auth` same-origin proxy; Traefik + Caddy examples with TLS/HSTS/CSP/rate-limit docs; self-hosting README; Playwright connect-and-sign-in e2e.

## Gate evidence (independent fresh run)

- `docker compose up -d --build`, then `docker compose ps`: postgres/minio/convex-backend **healthy**, web + dashboard up.
- `setup` ran automatically: workspace initialized, well-known written, generated secrets persisted to `.env`, one-time `SETUP_TOKEN` removed, exit 0. A re-run logged `server already initialized; skipping owner/workspace creation` (idempotent, single owner).
- `http://localhost:8080/api/auth/ok` → `{"ok":true}`; `sign-in/email` → 200 with `better-auth.session_token` + `better-auth.convex_jwt` cookies; JWT `RS256`, `sub` == owner id.
- `/.well-known/aulora.json` served `application/json`, validates against the core contract, `containsSecretField: false`, and its `name` reflects the configured workspace (volume overrides the dev stand-in).
- **Playwright `1 passed`**: connect by URL → sign in as owner → signed-in shell visible.
- Negative checks: wrong password → `401 INVALID_EMAIL_OR_PASSWORD`; cleared storage → back to the connect screen; built JS contains no baked-in backend origin.
- `git ls-files` has no `.env`, admin key, VAPID private key or setup token; generated files are gitignored. Root `turbo run typecheck lint test --force` → 19/19 successful.

## Decisions recorded

1. **No bundled reverse proxy.** TLS/HSTS/routing are the operator's edge (Coolify/Traefik/Caddy/nginx). The bundled `web` nginx only serves the SPA and proxies `/api/auth/*` to Convex HTTP actions (`3211`) so Better Auth cookies stay first-party; that route may be moved to the edge.
2. **Client typed only a server URL.** All provider config comes from `/.well-known/aulora.json`; client secrets stay in Convex env and are never returned by any query or route. Native uses Authorization Code + PKCE with `aulora://auth/callback`.
3. **Postgres is Convex's storage engine**, not an Aulora database. No app code touches it.
4. **`setup` auto-runs on `up`** and is idempotent; the admin key is minted per run from the instance secret (outputs differ, any minted key is valid for that instance).

## Known caveats / deferred

- **Passkeys are not wired**: `@better-auth/passkey` needs its own table (component local install). TOTP works. Tracked for a later phase.
- **Apple OAuth and the OIDC group-claim hook are unit-tested only**, not exercised against a live IdP (the Phase 0 spike proved generic OIDC discovery against Keycloak).
- **MinIO**: the community image is repackaged by Sourcemation (upstream removed community images); acknowledge the supply-chain trade-off or point at external S3. The `.env` has an S3-less fallback.
- **Clients**: desktop (Tauri) and mobile (Expo) are Phase 4; `infra/push-relay` is a stub (Phase 5).
- **Crypto/MLS is not in this phase.** `packages/crypto` with the `MlsEngine` interface and the OpenMLS-on-device work begins in Phase 2.
- Playwright currently covers connect + sign-in only; the channel/message/second-client path is Phase 2.

## Next: Phase 2

MLS group per channel/DM, encrypted messages/threads/reactions/edits/deletes/pins/mentions, encrypted uploads with client-side thumbnails and EXIF stripping, read state, typing, presence, local search index, and an offline outbox.
