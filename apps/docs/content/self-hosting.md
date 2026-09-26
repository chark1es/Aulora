# Self-hosting

One Aulora server runs one workspace. The whole stack is a Docker Compose
project under `infra/docker`: Postgres, the self-hosted Convex backend and
dashboard, MinIO object storage, the web SPA, and a one-shot `setup` container
that provisions everything on first run.

There is deliberately no TLS terminator in the stack. Put it behind your own
edge proxy (Coolify, Traefik, Caddy, nginx or a cloud load balancer).

## The installer

```sh
./install.sh            # macOS / Linux
pwsh ./install.ps1      # Windows
```

Useful flags and environment variables:

| Flag | Environment | Meaning |
| --- | --- | --- |
| `--name` / `-Name` | `AULORA_WORKSPACE_NAME` | workspace name |
| `--email` / `-Email` | `AULORA_OWNER_EMAIL` | owner account email |
| `--password` / `-Password` | `AULORA_OWNER_PASSWORD` | owner password (32+ chars) |
| `--port` / `-Port` | `AULORA_WEB_PORT` | host web port (default 8080) |
| `--site-url` / `-SiteUrl` | `AULORA_SITE_URL` | public origin for a real domain |
| `--backups` / `-Backups` | — | also start the nightly backup runner |
| `--no-start` / `-NoStart` | — | write `.env` and stop before `docker compose` |
| `--dry-run` / `-DryRun` | — | print the plan without changing anything |

The installer is idempotent: re-running it reuses the existing `.env` and is a
no-op for data.

## Manual first run

```sh
cd infra/docker
cp .env.example .env      # edit INSTANCE_NAME, WORKSPACE_NAME, OWNER_* and origins
docker compose up -d --build
docker compose logs -f setup
```

`setup` mints the admin key with the Convex backend's own `generate_key`,
generates the missing secrets (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, VAPID
keys, `BACKUP_TOKEN`), deploys `packages/convex`, creates the workspace and
owner, and writes `/.well-known/aulora.json`. It is safe to re-run.

## Local URL map

| Service | URL | Notes |
| --- | --- | --- |
| Web app | http://localhost:8080 | sign in here |
| Convex API / WebSocket | http://localhost:3210 | `CONVEX_CLOUD_ORIGIN` |
| Convex HTTP actions | http://localhost:3211 | `/api/auth`, `/setup/initialize` |
| Convex dashboard | http://localhost:6791 | paste the admin key; keep private |
| MinIO console | http://localhost:9001 | `MINIO_ROOT_USER` / password |
| Postgres | localhost:5432 | `POSTGRES_USER` / password |

## Auth is same-origin on purpose

The browser must see Better Auth as first-party, so `<SITE_URL>/api/auth/*` is
proxied to the Convex HTTP-actions port. Locally the web nginx container does
it; in production either keep that route or move it to your edge proxy. The
Convex backend must be able to resolve and fetch
`<CONVEX_SITE_ORIGIN>/api/auth/convex/jwks`, because it is the token issuer.

## Upgrade and teardown

```sh
docker compose pull
docker compose up -d --build
docker compose run --rm setup
```

`docker compose down` stops the stack but keeps the named volumes
(`pgdata`, `convex-data`, `minio-data`, `web-well-known`, `backup-data`).
`docker compose down -v` wipes them, irreversibly.

Keep `infra/docker/.env` safe: it holds `INSTANCE_SECRET`, and losing that makes
the existing data unreadable.
