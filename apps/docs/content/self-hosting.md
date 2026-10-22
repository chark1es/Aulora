# Self-hosting

One Aulora server runs one workspace. The whole stack is a Docker Compose
project under `infra/docker`: Postgres, the self-hosted Convex backend and
dashboard, MinIO object storage, the web SPA, and a one-shot `setup` container
that provisions everything on first run.

There is deliberately no TLS terminator in the stack. Put it behind your own
edge proxy (Coolify, Traefik, Caddy, nginx or a cloud load balancer). For a
guided deploy on [Coolify](https://coolify.io) see
[Deploy on Coolify](coolify.md), which uses the ready-made
`infra/docker/docker-compose.coolify.yml`.

## The installer

Install from a checkout of the stable `release` branch. `main` tracks
development, and the installer warns when it runs from another branch.

```sh
git clone --branch release https://github.com/chark1es/Aulora.git
cd Aulora
./install.sh            # macOS / Linux
pwsh ./install.ps1      # Windows
```

Useful flags and environment variables:

| Flag | Environment | Meaning |
| --- | --- | --- |
| `--name` / `-Name` | `AULORA_WORKSPACE_NAME` | workspace name |
| `--email` / `-Email` | `AULORA_OWNER_EMAIL` | owner account email |
| `--password` / `-Password` | `AULORA_OWNER_PASSWORD` | owner password (16+ chars) |
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
keys, the default local master key `AULORA_ENCRYPTION_KEY`),
deploys `packages/convex`, creates the workspace and owner, and writes
`/.well-known/aulora.json`. It is safe to re-run.

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

## Environment overrides from the admin panel

The workspace owner can override a curated set of variables from **Instance
admin → Environment** instead of editing `.env`, including the OAuth/OIDC
providers and a custom OIDC provider. Overrides live in the workspace database,
sealed with the server encryption key, and win over the deployment environment.
Deployment values are never shown, and secrets saved in the panel are
write-only. Anyone with owner access can change them, and a database restore
carries them with it, so keep credentials that should never change in `.env`.
Bootstrap settings such as `BETTER_AUTH_SECRET`, the encryption keys and
`SITE_URL` are read-only.

Overrides take effect on the next request, with no restart. The switch is read
from the deployment environment, so set `AULORA_ALLOW_UI_ENV_OVERRIDES=false` in
`.env` and re-run `docker compose run --rm setup` to disable the section and
fall back to `.env` alone. The
[environment variables reference](environment-variables.md) lists every variable
the stack reads: what it does, its type, whether it is a secret, and whether the
owner can override it.

## Disabling email & password sign-in

An instance can require SSO and refuse local email/password sign-in. Set the
gate either at deploy time or at runtime:

- **Deployment:** set `AUTH_LOCAL_ENABLED=false` in `.env` and re-run
  `docker compose run --rm setup` (or save it under **Instance admin →
  Environment**, which takes effect on the next request).
- **Runtime:** open **Instance admin → Auth providers** and switch off
  **Email & password sign-in**. This is stored with the instance settings, wins
  over the environment variable, and needs no redeploy.

When it is off, the server refuses Better Auth's email/password **sign-in and
sign-up** endpoints, not just the UI: the form is hidden on the web and mobile
clients and only the configured provider buttons are shown. Existing sessions
and already-created password accounts are unaffected — they simply cannot start
a new password sign-in until the gate is turned back on (for example to help a
user recover access).

**Lock-out protection.** Turning local sign-in off is refused while no other
sign-in method — GitHub, Google, Microsoft, Apple or OIDC — is both configured
and enabled. The admin panel shows an error instead of saving, and at config-read
time the server falls back to enabled rather than advertise a sign-in method
nobody could use. Configure and enable an SSO provider first. First-run owner
creation is never blocked by this gate: the setup container can always create
the operator credential.

## Same account across sign-in methods

If someone creates an account with email/password and later signs in with
Google, GitHub, Microsoft or Apple using the same address, the OAuth identity is
linked to the existing account instead of failing with `account not linked`.
Local addresses are never verified, so the link only happens when the provider
asserts that the address is verified, and sessions created before the link are
revoked. That way an address someone registered first, without owning it, cannot
keep access after the real owner signs in.

The generic OIDC provider is not trusted by default because many IdPs omit or
misreport `email_verified`. An OIDC sign-in therefore creates a separate account
unless you set `OIDC_TRUST_EMAIL=true` in the deployment environment (`.env`
plus `docker compose run --rm setup`, or the Coolify environment). Enable it
only when the IdP verifies addresses and you control who it issues them to.

## Encryption

Encryption is on by default and runs **server-side**: content and files are
sealed with AES-256-GCM envelope encryption. Setup saves the master key (the KEK) in `.env` and configures it
in the backend deployment environment. The default is the `local` provider: `setup`
generates a base64 32-byte `AULORA_ENCRYPTION_KEY` and persists it to `.env`, so
the default stack needs no extra services.

The KEK is the root of data confidentiality: back up `AULORA_ENCRYPTION_KEY`
separately from the database and never commit it. Encrypted content stays ciphertext in the database and exports. Account and other metadata may remain readable; losing the KEK makes that data
unreadable. `INSTANCE_SECRET` is only a legacy fallback the `local` provider uses
when `AULORA_ENCRYPTION_KEY` is unset.

### Optional / advanced: external key manager (EKM)

To delegate custody of the KEK, set `AULORA_EKM_PROVIDER` to `vault`,
`aws-kms`, `gcp-kms` or `http` and supply the matching settings (see
`.env.example`). The provider interface accepts them without code changes; the
default `docker compose up` starts none of this. For the optional bundled Vault,
start the `ekm` profile:

```sh
docker compose --profile ekm up -d
docker compose logs -f vault-init
```

It is dev mode and in-memory, so for production use a persistent Vault.

## Upgrade and teardown

From a git clone, the host updater fast-forwards to the published release tag
and redeploys. It refuses a dirty tree and does not touch `.env` or volumes.

```sh
cd infra/docker
./update.sh --check          # exit 10 when a release is newer
./update.sh --apply          # fast-forward and redeploy
./update.sh --watch          # enable download/restart controls in settings
./update.sh --download       # prepare a release without downtime
./update.sh --restart        # install the prepared release
```

The workspace owner can see the running version and check releases in
**Workspace settings → Instance**. Workspace update status and its settings dot
are visible only to the owner. Desktop app updates live in **Your settings →
Updates** and mark the user settings icon separately. While `--watch` runs
on the host, **Download update** prepares images in a separate checkout and
**Restart to update** installs them. Restart briefly interrupts the workspace;
messages, volumes, and `.env` are kept. A dot on settings indicates an available
update. Keep the watcher running under your host's service manager, with Bun and
the checkout dependencies installed.

Set `AULORA_AUTO_UPDATE=true` to prepare releases automatically. The watcher still
waits for the owner to restart. Restart the watcher and re-run `setup` after
changing update settings. Without the watcher, version information and release
checks remain available; use host or hosting-provider controls to install.

A checkout that is not a git clone, including Coolify, still updates by
redeploying the stable `release` branch:

```sh
docker compose pull
docker compose up -d --build
docker compose run --rm setup
```

`docker compose down` stops the stack but keeps the named volumes
(`pgdata`, `convex-data`, `minio-data`, `web-well-known`, `backup-data`).
`docker compose down -v` wipes them, irreversibly.

Keep `infra/docker/.env` safe: it holds `INSTANCE_SECRET`, the default
`AULORA_ENCRYPTION_KEY` and any external EKM settings, and the KEK it holds is
what makes the existing data readable. Losing the KEK makes the data unreadable.

## Public deployment checklist

Before exposing a server, replace `POSTGRES_PASSWORD` and the matching password in `POSTGRES_URL`, and replace `MINIO_ROOT_PASSWORD`. Configure DNS and valid HTTPS, reachable `SITE_URL`, `CONVEX_URL`, `CONVEX_CLOUD_ORIGIN`, and `CONVEX_SITE_ORIGIN`. Keep the auth route on the web origin and allow WebSocket upgrades. The origin settings are explained in the [proxy guide](https://github.com/chark1es/Aulora/blob/main/infra/docker/proxy/README.md).

The standard Compose file publishes database and administration ports for local use. Bind them to localhost or remove their published ports before public deployment. Keep the Convex dashboard, Postgres, and MinIO administration private. Coolify's file keeps services internal by default.

Start with a small test team and measure CPU, memory, storage, and upload growth on your host. There is no published capacity guarantee. Container builds need more resources than an idle server. Configure a TURN server if calls must work across restrictive networks.

## Screen streaming server (optional)

Calls are peer to peer, which suits small calls. To stream a desktop or application to many people, enable the optional LiveKit streaming server: open `7881/tcp` and `7882/udp` on the host and run `docker compose --profile streaming up -d`. It creates its own keys and is served from your existing web address, so there is nothing to configure. Under Coolify it is already running and only needs those two ports opened. Only screen and window shares go through it; voice and camera stay peer to peer, and clients that cannot use it (the mobile apps today) still receive shares directly. LiveKit is Apache-2.0 software run as a separate container. Details are in [infra/docker/README.md](https://github.com/chark1es/Aulora/blob/main/infra/docker/README.md#screen-streaming-optional).

Set signup/invitation policy, verify backups and a restore, and check the server from another network before inviting users. See [updates](updates.md), [backups](backups.md), and [troubleshooting](troubleshooting.md). Business use requires a [paid commercial agreement](licensing.md).
