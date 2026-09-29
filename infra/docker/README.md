# Self-hosting Aulora

This directory holds the Docker Compose stack that runs one Aulora workspace:
Postgres, the self-hosted Convex backend and dashboard, MinIO object storage,
the web SPA, and a one-shot `setup` container for first-run provisioning.

There is **no TLS terminator here** on purpose. Put the stack behind your own
edge proxy (Coolify, Traefik, Caddy, nginx, a cloud LB) — see `proxy/`.

For [Coolify](https://coolify.io), use `docker-compose.coolify.yml` instead of
`docker-compose.yml` and follow `../../../apps/docs/content/coolify.md`. It
publishes no host ports, marks the one-shot services for Coolify's health
check, and keeps generated secrets in the `setup-state` named volume so a
redeploy never regenerates the encryption master key.

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
(`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, VAPID keys, the default encryption key
`AULORA_ENCRYPTION_KEY`) back into `infra/docker/.env`.

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
| `hashicorp/vault` | `1.18` | optional EKM for the `ekm` profile (see below) |

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

## Encryption

Aulora encrypts content **server-side**: structured content and files are sealed
with AES-256-GCM envelope encryption, using a per-scope data key (DEK) derived
with HKDF-SHA256 from a single master key, the workspace salt and the record
scope. The scope, record id and key version are bound into the GCM additional
data, so a ciphertext cannot be moved to another record. Envelope headers name
the key version, so rotation does not require rewriting history in one pass.

The default is the **local** provider: the server derives the master key — the
**KEK** — from `AULORA_ENCRYPTION_KEY` (base64, 32 bytes). `setup` generates
that key on the first run and persists it to `.env`, so the default
`docker compose up` needs no extra services.

| Provider | Environment | Notes |
| --- | --- | --- |
| `local` (default) | `AULORA_ENCRYPTION_KEY` (fallback: `INSTANCE_SECRET`) | Key in `.env`, no extra service |

The KEK is the root of data confidentiality and lives outside the database. The
server holds it only in memory and decrypts for authorized clients; it never
writes key material to disk or to a backup. **If the KEK is lost, the existing
data is unreadable**, so back up `AULORA_ENCRYPTION_KEY` (or, if you move to an
external key manager, its KEK) separately and never commit it.
`INSTANCE_SECRET` is only a legacy fallback the `local` provider uses when
`AULORA_ENCRYPTION_KEY` is unset.

### Optional / advanced: external key manager (EKM)

To delegate custody of the KEK, set `AULORA_EKM_PROVIDER` to a remote provider
and supply its settings. The provider interface accepts them without code
changes, and the default `docker compose up` starts none of this. Remote
providers are **unwrap-only**: `AULORA_KEK_WRAPPED` is the master key encrypted
by that key manager, and the server asks it to unwrap the key on startup/cron.

| Provider | Environment | Notes |
| --- | --- | --- |
| `vault` | `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_TRANSIT_MOUNT`, `AULORA_KEK_WRAPPED` | Vault Transit unwrap |
| `aws-kms` | `AWS_REGION`, `AWS_KMS_KEY_ID`, `AULORA_KEK_WRAPPED` | AWS KMS unwrap |
| `gcp-kms` | `GCP_KMS_KEY_NAME`, `AULORA_KEK_WRAPPED` | GCP KMS unwrap |
| `http` | `EKM_PROXY_URL`, `EKM_PROXY_TOKEN`, `AULORA_KEK_WRAPPED` | Your own unwrap proxy |

Set `AULORA_EKM_PROVIDER` accordingly; `AULORA_EKM_KEY_ID` names the KEK and
`AULORA_ENCRYPTION_KEY_VERSION` bumps on rotation. See `.env.example` for every
variable and `packages/convex/convex/lib/ekm.ts` for the contract.

#### Bundled Vault (optional)

For a quick Vault-backed setup, start the `ekm` profile (the default
`docker compose up` does not start Vault):

```powershell
docker compose --profile ekm up -d
docker compose logs -f vault-init
```

This starts a HashiCorp Vault in **dev mode** plus a one-shot `vault-init` that
enables the transit secrets engine, creates the KEK, and (when a local key is
present) wraps `AULORA_ENCRYPTION_KEY` into `AULORA_KEK_WRAPPED` in `.env`. Set
`AULORA_EKM_PROVIDER=vault` and re-run `docker compose run --rm setup` to apply
it. Dev mode stores data in memory, so its KEK is lost on restart: use a
persistent Vault for production and back up the KEK separately.

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

Better Auth checks the browser `Origin` against `SITE_URL`, the built-in
`aulora://` scheme and the comma-separated `TRUSTED_ORIGINS`. If you reach the
web app on a LAN or Tailscale IP (e.g. `http://100.64.0.10:8080`), add that
origin to `TRUSTED_ORIGINS` in `.env` and re-run
`docker compose run --rm setup` to push it to the deployment.

## `/.well-known/aulora.json`

`setup` writes the real per-instance document into the `web-well-known` volume
from `server:publicConfig`. It contains only public data (name, versions, Convex
URL, site URL, icon seed, enabled auth providers) and never a secret. It is
gitignored and must not be committed.

## Upgrade

```powershell
cd infra/docker
./deploy.sh --pull
```

`deploy.sh` always rebuilds the `web` and `setup` images before recreating the
web container and redeploying the Convex functions. Do not skip the rebuild:
`docker compose run --rm setup` reuses whatever `aulora-setup` image already
exists, so a stale image would redeploy an **old API** against a new client.
`setup` self-checks after deploying and fails loudly if any module in
`packages/convex` is missing from the deployment.

The manual equivalent, if you prefer explicit commands:

```powershell
docker compose pull             # new upstream tags/digests
docker compose build web setup  # ALWAYS rebuild local images
docker compose up -d web        # recreate the web container with the new build
docker compose run --rm setup   # re-deploy functions, refresh well-known
```

`setup` re-runs are no-ops for data. Before switching database or storage
providers, migrate with `convex export` / `convex import` (see the Convex
self-hosting docs).

### HTTP caching

The web container sends cache headers that make a redeploy safe without a hard
refresh:

- `/assets/*` (vite content-hashed filenames) — `Cache-Control: max-age=31536000`.
  A new build ships new names, so cached files are never reused.
- `/index.html`, `/push-sw.js`, `/theme-boot.js` — `Cache-Control: no-cache`
  (revalidated with a 304 while unchanged). These unhashed shell files must
  never be served stale, or a service worker or the theme bootstrap would pin
  clients to an old build.
- `/.well-known/*` — `no-cache`, so workspace name, auth providers and the
  Convex URL refresh as soon as `setup` rewrites the document.

## Backup and restore

Three things hold state; back all of them:

1. **Convex data** — a logical export is the portable backup:

   ```powershell
   docker compose run --rm setup bash -lc `
     "cd /app/packages/convex && bunx convex export --path /convex/data/backup.zip"
   # Use `docker compose cp` rather than a hardcoded container name: the
   # generated name (<project>-convex-backend-1) changes with the Compose
   # project name, which Coolify and COMPOSE_PROJECT_NAME both control.
   docker compose cp convex-backend:/convex/data/backup.zip ./backup.zip
   ```

   (`convex export` also covers S3-backed file storage.) Alternatively
   `docker compose exec postgres pg_dump …`.

2. **Postgres** — `docker compose exec postgres pg_dump -U convex <db> > dump.sql`.
3. **Secrets** — `infra/docker/.env`, which holds `INSTANCE_SECRET`,
   `BETTER_AUTH_SECRET`, VAPID keys and the default `AULORA_ENCRYPTION_KEY`. That
   encryption key is the KEK and is what makes the ciphertext-at-rest data
   readable; **losing it makes the existing data unreadable**, so back up `.env`
   (and, if you use an optional external key manager, its KEK) separately and
   securely, and never commit it. `INSTANCE_SECRET` remains required for the
   Convex admin key.

Restore: bring up a fresh stack, restore Postgres/`convex export`, restore
`.env` (and make sure the KEK is available), then run `setup`.

### Nightly runner (optional)

Instead of doing the above by hand, enable the `backups` profile. It runs
`pg_dump` + `convex export` at `BACKUP_HOUR_UTC` (default 03:00 UTC), uploads
both to the S3/MinIO bucket `BACKUP_BUCKET` and records the result for the
instance admin panel:

```powershell
docker compose --profile backups up -d --build
docker compose logs -f backup
```

The Convex cron records the nightly intent; the runner performs the work. Run
one immediately with `docker compose run --rm -e BACKUP_RUN_ONCE=1 backup`, or
use the panel's "Request backup now". See `backup/README.md`.

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
