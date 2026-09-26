# Spike A Report — Convex self-hosted / Postgres / Better Auth / Keycloak

Date: 2026-09-26. Environment: Windows 10/11, PowerShell 5.1, Docker 28.1.1
(Compose v2.35.1), bun 1.4.0, node v22.18.0. All work under
`spikes/convex-selfhost/`. Nothing committed.

## URLs and versions checked

Source of truth (fetched live, not from memory):

- `https://github.com/get-convex/convex-backend/tree/main/self-hosted` — README (compose location, ports, admin key, Postgres pointer).
- `https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/docker/docker-compose.yml` — official compose.
- `https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/advanced/postgres_or_mysql.md` — `POSTGRES_URL`, `DO_NOT_REQUIRE_SSL`, DB-name-from-instance rule.
- `https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/CHANGELOG.md`.
- `https://www.npmjs.com/package/@convex-dev/better-auth` + `npm view` — versions.
- `https://labs.convex.dev/better-auth/framework-guides/react` — component mount API for 0.12.
- `https://labs.convex.dev/better-auth/basic-usage`.
- `https://labs.convex.dev/better-auth/supported-plugins` — supported/incompatible plugin list.
- `https://raw.githubusercontent.com/get-convex/better-auth/main/package.json` — peer deps.
- `https://github.com/better-auth/better-auth/issues/5314` + `https://api.github.com/repos/better-auth/better-auth/issues/5314/timeline` — status.
- `https://better-auth.com/docs/plugins/generic-oauth` — generic OAuth/OIDC config.

Resolved versions:

- Convex images: `ghcr.io/get-convex/convex-backend:latest` and `convex-dashboard:latest`, commit `0cf49cbf8c4b7e22e631ceda9b5111f6cccbcd49`, built 2026-09-21. Time-to-pull: several minutes.
- `convex` (CLI/npm): **1.46.0**
- `@convex-dev/better-auth`: **0.12.5** (published ~3 months before this spike)
- `better-auth`: installed **1.6.15**; latest on npm is **1.7.6**
- `@better-auth/sso`: latest **1.7.6** (not used)
- `postgres:17`, `quay.io/keycloak/keycloak:26.3`

## What was run and what happened

### 1. Convex self-hosted on Postgres — WORKED

`docker compose up -d` (with Docker Desktop cold-started first) brought up
backend + dashboard + Postgres. All healthy.

```
NAME                          IMAGE                                        STATUS
convex-selfhost-backend-1     ghcr.io/get-convex/convex-backend:latest     Up (healthy)  0.0.0.0:3210-3211->3210-3211/tcp
convex-selfhost-dashboard-1   ghcr.io/get-convex/convex-dashboard:latest   Up            0.0.0.0:6791->6791/tcp
convex-selfhost-postgres-1    postgres:17                                  Up (healthy)  0.0.0.0:5432->5432/tcp
convex-selfhost-keycloak-1    quay.io/keycloak/keycloak:26.3               Up (healthy)  0.0.0.0:8080->8080/tcp
```

Health / identity:

```
GET http://localhost:3210/version       -> 200 OK, body: "unknown"
GET http://localhost:3210/instance_name -> aulora-spike
```

`/version` returns `unknown` because the self-hosted build ships without a release
version string (the healthcheck still passes). Backend logs:

```
INFO db_connection: Connected to Postgres database: aulora-spike
INFO model::migrations: db metadata version up to date at 132
INFO common::http: backend listening on 0.0.0.0:3210
INFO common::http: backend_http_proxy listening on 0.0.0.0:3211
```

Data really is in Postgres (`docker compose exec postgres psql -U convex -d aulora_spike -c "\dt"`):

```
 public | documents  | table | convex
 public | indexes    | table | convex
 public | leases     | table | convex
 public | persistence_globals | table | convex
 public | read_only  | table | convex
```

Admin key: `docker compose exec -T backend ./generate_admin_key.sh` prints
`<instance>|<hex>`. Note it mints a **new random key on every call**; the most
recent one is what must be used.

Conclusion: **self-hosted Convex + external Postgres is real and working.**

### 2. Deploy a function — WORKED

Minimal project in `app/` (`convex/ping.ts`, `convex/messages.ts`) deployed with
`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`:

```
✔ Deployed Convex functions to http://127.0.0.1:3210
```

Then executed:

```
$ convex run ping:ping            -> "pong-from-selfhosted-convex"
$ convex run messages:send ...    -> (wrote row)
$ convex run messages:list        -> [{ _id: "j57147...", author: "spike", body: "hello" }]
```

Conclusion: **self-hosted deploy + `convex run` works, and it is impossible to skip
a real server round-trip.**

### 3. Better Auth on Convex — WORKED for generic OAuth/OIDC

Mount API (0.12): `convex/convex.config.ts` `app.use(betterAuth)`, `convex/auth.ts`
`createClient<DataModel>(components.betterAuth)`, `convex/auth.config.ts`
`getAuthConfigProvider()`, `convex/http.ts`
`authComponent.registerRoutes(http, createAuth, { cors: true })`.

After adding `better-auth@1.6.15` + `@convex-dev/better-auth@0.12.5` and the
`genericOAuth` plugin, `convex deploy` succeeded and installed the component:

```
✔ Installed component betterAuth.
✔ Deployed Convex functions to http://127.0.0.1:3210
```

The mounted auth routes execute inside Convex:

```
GET http://localhost:3211/api/auth/ok -> {"ok":true}
```

**Issue #5314 status (checked live):** state = `closed (completed)`. It was closed
by the original reporter on 2025-10-24 (no `state_reason`) and later **locked as
`resolved` by the `better-auth` org on 2026-03-31**. The only technical replies are
from the Dosu bot, which stated the plugins import Node builtins (`crypto`,
`constants`, `fs`) and that "there is no built-in serverless or
Convex-compatible alternative … right now". No linked PR/fix exists in the
timeline. So: closed **without an upstream code fix**.

However, the Convex maintainers draw the line differently, and current docs are
the authoritative integration statement:

- `labs.convex.dev/better-auth/supported-plugins` lists **Generic OAuth** as
  supported "out of the box".
- It lists **SSO** as **incompatible** ("has direct dependencies on Node.js").

Empirically, `genericOAuth` bundled and ran. The plugin classes in #5314 were the
**OIDC *provider*** (`oidcProvider`, i.e. making Better Auth itself an IdP) and
**`@better-auth/sso`** — those are not `genericOAuth`.

**Version trap found:** `@convex-dev/better-auth@0.12.5` declares
`"better-auth": ">=1.6.11 <1.7.0"`. npm `latest` is `1.7.6`, which is **outside the
supported range**. We pinned `better-auth@1.6.15`. Using 1.7.x risks type/runtime
breakage (known `registerRoutes` type errors were reported when 1.5 shipped before
the component caught up).

### 4. Keycloak + Better Auth generic OIDC — WORKED (server-side)

Keycloak 26.3 started with realm `aulora` and confidential client `aulora-convex`
imported from `keycloak/aulora-realm.json`. Discovery:

```
GET http://localhost:8080/realms/aulora/.well-known/openid-configuration -> 200
  issuer: http://keycloak:8080/realms/aulora
  authorization_endpoint: .../protocol/openid-connect/auth
  token_endpoint: .../protocol/openid-connect/token
  ... (full standard OIDC metadata)
```

With `genericOAuth` configured as:

```ts
genericOAuth({ config: [{
  providerId: "keycloak",
  discoveryUrl: "http://keycloak:8080/realms/aulora/.well-known/openid-configuration",
  clientId: "aulora-convex",
  clientSecret: "spike-secret",
  scopes: ["openid", "profile", "email"],
}]})
```

the Convex HTTP action (from **inside** the backend container) fetched that
discovery document and generated a real authorization request:

```
POST http://localhost:3211/api/auth/sign-in/oauth2
  -> 200 {"url":"http://keycloak:8080/realms/aulora/protocol/openid-connect/auth
       ?response_type=code&client_id=aulora-convex&state=...&scope=openid+profile+email
       &redirect_uri=http%3A%2F%2F127.0.0.1%3A3211%2Fapi%2Fauth%2Foauth2%2Fcallback%2Fkeycloak",
       "redirect":true}
```

This proves the full server-side generic OIDC path (discovery → authorize URL)
runs inside Convex's HTTP actions, not a separate Node server.

Two notes / one caveat:
- `KC_HOSTNAME=http://keycloak:8080` was needed so advertised endpoints are
  reachable from the backend container. That host is not browser-resolvable; a real
  deployment must publish Keycloak (or a proxy) on a shared public hostname, and
  then use that in `discoveryUrl`.
- An early call returned `403 {"code":"INVALID_CALLBACK_URL"}` until
  `trustedOrigins` was set — expected Better Auth behavior, not a Convex issue.

## Failures / friction encountered

- Docker Desktop engine was not running; the named pipe
  `dockerDesktopLinuxEngine` was missing. Started the app and polled `docker info`
  until up. Not a Convex issue.
- PowerShell 5.1 mangles inline JSON passed to native CLIs; use `'{\"k\":\"v\"}'`
  escaping (documented in README). Not a product issue.
- `convex env set CONVEX_SITE_URL` is rejected: `EnvVarNameForbidden: ...
  "CONVEX_SITE_URL" is built-in and cannot be overridden`. It is auto-provided.
- No functional failure in items 1–4.

## Verdict and recommendation

| Item | Verdict |
|---|---|
| 1. Convex self-hosted + Postgres | **PROCEED** |
| 2. Deploy function self-hosted | **PROCEED** |
| 3. Better Auth on Convex (generic OAuth/OIDC) | **PROCEED with pins** |
| 4. Keycloak generic OIDC via Better Auth | **PROCEED** (server-side proven) |

Concrete recommendations:

1. **Proceed** with self-hosted Convex + external Postgres. Pin image versions
   (not `:latest`) for reproducibility; use a managed/persistent Postgres in
   production and keep `INSTANCE_SECRET` stable and secret-managed.
2. **Pin `better-auth@1.6.15`** (or the exact version matching the
   `@convex-dev/better-auth` peer range) and pin `@convex-dev/better-auth@0.12.5`.
   Do **not** adopt `better-auth@1.7.6` until the component widens its peer range;
   add an automated check/renovate constraint.
3. For Aulora team auth via an external OIDC IdP (Keycloak/Entra/Okta), use the
   **`genericOAuth` plugin** — supported and proven. Configure a real public
   Keycloak hostname for `discoveryUrl` and set `trustedOrigins`.
4. **Do not** plan on `oidcProvider` (Better Auth as an IdP, issue #5314) or
   `@better-auth/sso` inside Convex — both remain Node-only/unsupported. If Aulora
   must itself be an OIDC provider or needs enterprise SSO/SAML, plan a separate
   Node service, or wait for upstream support.
5. Caveat to track: an open upstream issue notes `genericOAuth` discovery is
   fetched during plugin init, uncached and without timeout — for a Keycloak
   outage this can surface as 500s. Add caching/health checks / a fallback in
   production.
