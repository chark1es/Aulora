# Spike A — Convex self-hosted + Postgres + Better Auth + Keycloak

De-risks the backend/auth hosting story for Aulora (self-hosted, E2EE team chat).
Everything runs locally in Docker. **Never commit `.env` or `app/.env.local`.**

Versions proven in this spike:

| Component | Version / ref |
|---|---|
| Convex backend image | `ghcr.io/get-convex/convex-backend:latest` (commit `0cf49cbf8c4b7e22e631ceda9b5111f6cccbcd49`, built 2026-09-21) |
| Convex dashboard image | `ghcr.io/get-convex/convex-dashboard:latest` |
| Convex CLI/npm | `1.46.0` |
| Postgres | `postgres:17` |
| `@convex-dev/better-auth` | `0.12.5` (peer: `better-auth >=1.6.11 <1.7.0`) |
| `better-auth` | `1.6.15` (pinned; latest npm is `1.7.6` but is **out of peer range**) |
| Keycloak | `quay.io/keycloak/keycloak:26.3` |

Ports: `3210` API, `3211` HTTP actions, `6791` dashboard, `5432` Postgres, `8080` Keycloak.

## 1. Backend + Postgres

```powershell
cd spikes/convex-selfhost

# Generate a real .env with a 64-hex INSTANCE_SECRET
$b = New-Object 'System.Byte[]' 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$secret = ($b | ForEach-Object { $_.ToString('x2') }) -join ''
(Get-Content .env.example -Raw) -replace 'replace-with-64-hex-chars', $secret |
  Set-Content .env -NoNewline

docker compose up -d
docker compose ps
curl.exe -s http://localhost:3210/version        # -> unknown (self-hosted build has no release version)
curl.exe -s http://localhost:3210/instance_name  # -> aulora-spike
docker compose logs backend | Select-String "Connected to Postgres"
```

`POSTGRES_URL` must **not** include a database name; the backend connects to the
database named after `INSTANCE_NAME` (`aulora-spike` → `aulora_spike`). That DB is
created by `initdb/01-create-convex-db.sql` on first Postgres init. Local Postgres
needs `DO_NOT_REQUIRE_SSL=1`.

Generate an admin key (a new random key is minted per call; the latest one is what
goes in `app/.env.local`):

```powershell
docker compose exec -T backend ./generate_admin_key.sh
```

Dashboard: http://localhost:6791 (paste the admin key).

## 2. Deploy a function

```powershell
cd app
bun install
# app/.env.local:
#   CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
#   CONVEX_SELF_HOSTED_ADMIN_KEY='<key>'
$env:CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
$env:CONVEX_SELF_HOSTED_ADMIN_KEY='<key>'
bunx convex deploy --yes
bunx convex run ping:ping
bunx convex run messages:send '{\"body\":\"hello\",\"author\":\"spike\"}'
bunx convex run messages:list
```

## 3 & 4. Better Auth + Keycloak

```powershell
docker compose --profile keycloak up -d
curl.exe -s http://localhost:8080/realms/aulora/.well-known/openid-configuration

cd app
bunx convex env set BETTER_AUTH_SECRET 'spike-secret-spike-secret-spike-secret-32'
# CONVEX_SITE_URL is built-in and auto-provided; it cannot be overridden.
bunx convex deploy --yes
# genericOAuth -> Keycloak authorization URL:
curl.exe -s -X POST http://localhost:3211/api/auth/sign-in/oauth2 `
  -H "content-type: application/json" `
  -d '{\"providerId\":\"keycloak\",\"callbackURL\":\"http://localhost:5173\"}'
```

Keycloak realm `aulora` + client `aulora-convex` are auto-imported from
`keycloak/aulora-realm.json`. `KC_HOSTNAME=http://keycloak:8080` makes discovery
reachable from the Convex backend container (browsers can't resolve that host — a
real deployment must use a shared public hostname).

## Teardown

```powershell
docker compose --profile keycloak down       # keep volumes
docker compose --profile keycloak down -v    # wipe data
```
