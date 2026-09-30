# @aulora/convex

Aulora's Convex backend: schema, Better Auth mount, permission checks, public
server config and one-time setup. Deployed to the self-hosted Convex backend.

## Pinned versions

| Package | Version |
| --- | --- |
| `convex` | `1.46.0` |
| `@convex-dev/better-auth` | `0.12.5` (peer `better-auth >=1.6.11 <1.7.0`) |
| `better-auth` | `1.6.22` (do **not** bump to `1.7.x`, it is outside the peer range) |

## Scripts

```powershell
bun run dev        # convex dev against the self-hosted backend
bun run deploy     # convex deploy --yes
bun run codegen    # regenerate convex/_generated
bun run typecheck
bun run test       # vitest + convex-test
```

Set `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` (see
`.env.local`, template in `.env.example`) before `dev`/`deploy`/`codegen`.

## Auth

`convex/http.ts` mounts Better Auth under `/api/auth` via
`authComponent.registerRoutes(http, createAuth, { cors: true })` (health:
`GET /api/auth/ok` -> `{"ok":true}`).

- Local email/password, optional TOTP 2FA (`twoFactor` plugin).
- Built-in OAuth: GitHub, Google, Microsoft, Apple; each appears only when its
  `*_CLIENT_ID` and `*_CLIENT_SECRET` are set.
- Generic OIDC (`genericOAuth` discovery URL) for Keycloak, Authentik, Authelia,
  Okta, Zitadel, Entra ID; enabled when `OIDC_*` is complete (see `.env.example`).
- OIDC group claim -> Aulora role mapping: `OIDC_GROUP_CLAIM` +
  `OIDC_GROUP_ROLE_MAP` (JSON) create/attach roles on first sign-in.
- Native redirect `aulora://auth/callback` is trusted for Authorization Code +
  PKCE.

Passkeys are not wired yet: `@better-auth/passkey` needs a `passkey` table, so
it requires the component's Local Install path. TOTP is supported out of the box.

Secrets stay server-side. `server:publicConfig` returns only provider
id/type/display name and, for OIDC, issuer/discovery URL/client id/scopes. It
never returns `clientSecret` or any credential.

## First-run setup

Set a one-time `SETUP_TOKEN` on the deployment, then either POST to the site
origin:

```powershell
$body = @{ setupToken = '<token>'; name = 'Acme'; email = 'owner@acme.com'; password = '<password>' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3211/setup/initialize' -Method Post -Body $body -ContentType 'application/json'
```

or run the action directly:

```powershell
bunx convex run setup:initialize '{\"token\":\"<token>\",\"name\":\"Acme\",\"email\":\"owner@acme.com\",\"password\":\"<password>\"}'
```

It refuses a second run and returns `{ serverId, roleId, ownerId }`. Remove
`SETUP_TOKEN` afterwards.

## Instance admin

`convex/instance.ts` backs the operator-only admin panel: `settings` and
`overview` queries plus `updateStorage`, `updatePushRelay` and `updateBackups`
mutations. Every function calls `requireInstanceAdmin`, which accepts only the
workspace owner created by setup — roles never grant instance authority. Secrets
are reported as booleans; the OIDC client secret, `PUSH_RELAY_TOKEN` and
`BACKUP_TOKEN` are never returned.

- `instanceSettings` stores the total storage quota, the per-upload cap, the
  relay enabled flag/URL/server id and the backup on/off flag.
- `convex/license.ts` accepts opaque `AULORA2_` subscription keys for the instance
  owner. `licenseActions.ts` validates them over HTTPS with the Aulora licensing
  server, and `lib/licenseProof.ts` verifies the signed response, nonce, key hash,
  installation, and one-hour lease. A cron refreshes every 30 minutes. Historical
  checksum keys are no longer accepted. Status does not interrupt chat access.
  Company subscriptions cost $1/member/month or $10/member/year; see [COMMERCIAL.md](../../COMMERCIAL.md).
- `convex/backups.ts` records backup runs. A cron at `0 3 * * *` writes the
  nightly intent unless backups are disabled; the outside runner
  (`infra/docker/backup`) does the export + dump + upload and reports the result
  through `backups.record`, gated by the constant-time `BACKUP_TOKEN` check.

## Monthly active-user billing

Version-2 licenses report distinct monthly active users rather than enforcing a purchased member cap. Successful auth session creation/refresh, presence mutations, and message sends call the same server-side deduplication helper. `licenseActivity` stores local identities per license and UTC month; `licenseUsageMonths` stores counts. Collection begins only after signed activation and stops at the verified paid expiration or explicit invalidation. A transient validation outage cannot discard activity in that paid term.

`licenseUsageActions.report` sends aggregate snapshots hourly over HTTPS, authenticating with the license key. Queued reports use purpose-bound encrypted `licenseReportKeys`, so expiry or local key removal cannot discard the final reporting obligation. Acknowledgment preserves aggregates and purges local identity rows after a final report. All reporting queries/mutations are internal; only the instance administrator can view aggregate summaries. The licensing authority rejects decreasing counts and locks final reports, calculates partial license-month coverage, and adds report-based charges or credits to later recurring Stripe invoices. New subscriptions are monthly only.
