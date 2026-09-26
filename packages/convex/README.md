# @aulora/convex

Aulora's Convex backend: schema, Better Auth mount, permission checks, public
server config and one-time setup. Deployed to the self-hosted Convex backend.

## Pinned versions

| Package | Version |
| --- | --- |
| `convex` | `1.46.0` |
| `@convex-dev/better-auth` | `0.12.5` (peer `better-auth >=1.6.11 <1.7.0`) |
| `better-auth` | `1.6.15` (do **not** bump to `1.7.x`, it is outside the peer range) |

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
