# Self-hosting Aulora

This directory holds the Docker Compose stack that runs one Aulora workspace:
Postgres, the self-hosted Convex backend and dashboard, MinIO object storage,
the web SPA, and a one-shot `setup` container for first-run provisioning.

There is **no TLS terminator here** on purpose. Put the stack behind your own
edge proxy (Coolify, Traefik, Caddy, nginx, a cloud LB) — see `proxy/`.

## First run

```powershell
cd infra/docker

# 1. Create your config and edit the CHANGE ME values.
Copy-Item .env.example .env
#    Set at least: INSTANCE_NAME, WORKSPACE_NAME, OWNER_EMAIL, OWNER_PASSWORD,
#    SITE_URL and (for a public deploy) the CONVEX_*_ORIGIN values.

# 2. Build and start the stack. The one-shot `setup` service starts on its own
#    once the backend is healthy; it is idempotent, so this is safe on every up.
docker compose up -d --build

# 3. Wait for first-run setup to finish before signing in.
docker compose logs -f setup

# 4. Optional: re-run setup explicitly at any time (idempotent).
docker compose run --rm setup

# 5. Open the web app and sign in as the owner.
#    http://localhost:8080   (host WEB_PORT; default 8080)
```

`setup` mints the admin key, generates the missing secrets, deploys the Convex
functions, creates the workspace + owner account, and writes the public
`/.well-known/aulora.json`. It also persists generated secrets
(`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, VAPID keys) back into `infra/docker/.env`.

### Local URL map

| Service           | URL                     | Notes |
| ----------------- | ----------------------- | ----- |
| Web app           | http://localhost:8080   | Sign in here |
| Convex API / WS   | http://localhost:3210   | `CONVEX_CLOUD_ORIGIN` |
| Convex HTTP actions | http://localhost:3211 | `/api/auth`, `/setup/initialize` |
| Convex dashboard  | http://localhost:6791   | Paste the admin key; keep private |
| MinIO console     | http://localhost:9001   | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| Postgres          | localhost:5432          | `POSTGRES_USER` / `POSTGRES_PASSWORD` |

## Why `setup` rather than manual steps

The self-hosted Convex backend image ships `/convex/generate_key`. The admin key
is an authorization token minted from the instance secret; each mint adds a
random nonce, so successive outputs differ but any minted key is valid for that
instance. The `setup` image copies that binary out of the exact backend image
digest we run, mints a key **without `docker exec`**, and uses it to deploy and
configure the deployment. Everything it does is idempotent:

- instance name/secret are resolved from the running backend;
- secrets are generated only when absent (`BETTER_AUTH_SECRET`, a one-time
  `SETUP_TOKEN`, and a VAPID P-256 key pair for Web Push);
- the admin key is minted with the backend's own `/convex/generate_key`, so the
  deployment is configured without `docker exec`;
- the deployment env is set with `convex env set` (overwrite-safe; built-in
  names like `CONVEX_SITE_URL` / `CONVEX_CLOUD_URL` are never overridden);
- a second `setup/initialize` is refused by Convex itself (no duplicate owner);
- the well-known document is rewritten each run from `server:publicConfig`.

## Pinned images

Reproducibility matters more than freshness here, so every image is pinned:

| Image | Pin | Why |
| --- | --- | --- |
| `ghcr.io/get-convex/convex-backend` | **digest** `sha256:b756b066…` | Convex publishes only `latest` + commit tags; the digest corresponds to revision `0cf49cbf` |
| `ghcr.io/get-convex/convex-dashboard` | **digest** `sha256:4ebaebfd…` | same |
| `postgres` | `postgres:17` | explicit major |
| `nginx` (web runtime) | `nginx:1.27-alpine` | explicit minor |
| `oven/bun` (build + setup) | `oven/bun:1.4.0` | matches `packageManager` |
| `sourcemation/minio` | `RELEASE.2025-10-15T17-29-55Z-20260920` | last AGPL MinIO release (see below) |
| `pgsty/mc` | digest `sha256:cfc831…` | MinIO client used for bucket init |

To bump the Convex digest:

```powershell
docker pull ghcr.io/get-convex/convex-backend:latest
docker inspect ghcr.io/get-convex/convex-backend:latest `
  --format '{{index .RepoDigests 0}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

## Object storage (MinIO)

MinIO discontinued its community/open-source edition and removed its Docker Hub
images (`minio/minio`) in late 2025; the remaining `aistor` images require a
license. This stack therefore uses the last community build, repackaged by the
Sourcemation project. Acknowledge that supply-chain trade-off before a real
deployment, or **point at any external S3 instead**:

- set `S3_ENDPOINT_URL`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (or `AWS_*`)
  and the five `S3_STORAGE_*_BUCKET` names in `.env`; or
- remove the `S3_*`/`AWS_*` block from the `convex-backend` service to fall back
  to the backend's local volume storage (fine for a single-node install).

MinIO and most S3-compatible stores need **path-style** addressing and do not
implement the AWS SDK's default payload checksums or SSE headers, so the backend
also gets `AWS_S3_FORCE_PATH_STYLE`, `AWS_S3_DISABLE_CHECKSUMS` and
`AWS_S3_DISABLE_SSE` (all default `true`). Set them to `false` only for real AWS
S3.

`minio-init` waits for MinIO and creates the buckets idempotently on every
`up`.

## The auth proxy contract

The browser must see Better Auth as **same-origin** so the session cookie is
first-party. That means `<SITE_URL>/api/auth/*` is proxied to the Convex
HTTP-actions port (`convex-backend:3211`, never `3210`):

- locally, the `web` nginx container does it;
- in production, either the `web` container keeps doing it, or you move the
  route to your edge proxy (both examples are in `proxy/`);
- `CONVEX_SITE_ORIGIN` must be the **public web origin**, and the Convex backend
  must be able to resolve + fetch `<CONVEX_SITE_ORIGIN>/api/auth/convex/jwks`
  (it is the token issuer). Keep client and backend consistent.

## `/.well-known/aulora.json`

`setup` writes the real per-instance document into the `web-well-known` volume
from `server:publicConfig`. It contains only public data (name, versions, Convex
URL, site URL, icon seed, enabled auth providers) and never a secret. It is
gitignored and must not be committed.

## Upgrade

```powershell
cd infra/docker
docker compose pull            # new upstream tags/digests
docker compose up -d --build   # rebuild web + setup, recreate changed services
docker compose run --rm setup  # re-deploy functions, refresh well-known
```

`setup` re-runs are no-ops for data. Before switching database or storage
providers, migrate with `convex export` / `convex import` (see the Convex
self-hosting docs).

## Backup and restore

Three things hold state; back all of them:

1. **Convex data** — a logical export is the portable backup:

   ```powershell
   docker compose run --rm setup bash -lc `
     "cd /app/packages/convex && bunx convex export --path /convex/data/backup.zip"
   docker cp aulora-convex-backend-1:/convex/data/backup.zip ./backup.zip
   ```

   (`convex export` also covers S3-backed file storage.) Alternatively
   `docker compose exec postgres pg_dump …`.

2. **Postgres** — `docker compose exec postgres pg_dump -U convex <db> > dump.sql`.
3. **Secrets** — `infra/docker/.env` (it holds `INSTANCE_SECRET`,
   `BETTER_AUTH_SECRET`, VAPID keys). Losing `INSTANCE_SECRET` makes the existing
   data unreadable, so back it up separately and securely.

Restore: bring up a fresh stack, restore Postgres/`convex export`, restore
`.env`, then run `setup`.

## Teardown

```powershell
docker compose down          # stop, KEEP volumes (data + secrets persist)
docker compose down -v       # stop and WIPE volumes (irreversible)
```

Tearing down with `down` (no `-v`) is the safe default: the named volumes
`pgdata`, `convex-data`, `minio-data` and `web-well-known` survive, so a later
`up` resumes exactly where you left off.

## Troubleshooting

- **`setup` says "OWNER_EMAIL is not set"** — edit `.env` and re-run.
- **Login redirects but the session does not stick** — the auth path is not
  same-origin. Check that `/api/auth/*` reaches `3211` and that cookies are not
  being stripped by your edge.
- **`/instance_name` unreachable** — the backend is not healthy; check
  `docker compose logs convex-backend` and that `POSTGRES_URL` has no database
  name.
- **Well-known 404** — run `setup`; it writes the document after a successful
  deploy.
