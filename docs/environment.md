# Environment classification and ownership

Aulora keeps the Docker deployment's required environment at the bootstrap
minimum. Everything that can change at runtime is owned by the workspace owner
through **Instance admin → Environment**. Environment variables remain fully
supported: setting one in `infra/docker/.env` (or in the compose/Coolify
environment) still works, and an environment value is the fallback whenever the
owner has not saved an override.

The catalogue in `packages/convex/convex/lib/envCatalog*.ts` is the machine
truth. Every entry declares a `tier`:

| Tier | Meaning | Where it is set |
| --- | --- | --- |
| `bootstrap` | Required before the database, auth or encryption path can serve a request. Losing it can lock everyone out or make data unreadable. | `infra/docker/.env` (or the orchestrator environment). Never overridable. |
| `deploy-time` | Read at deploy, module load, container start or by a host-side tool. A running deployment cannot apply a change live. | Deployment environment. Never overridable. |
| `overridable` | Curated integration and behaviour settings. The owner can set, replace and clear them from the panel. | Instance admin → Environment, with an environment value as fallback. |

The generated public **Environment variables** page (`apps/docs`, rendered from
the same catalogue) shows the tier on every row. The default
`infra/docker/.env.example` ships the bootstrap values plus documented
deploy-time defaults; overridable keys are commented or absent so they cannot
shadow a panel override.

## Bootstrap tier

These values must exist before first use. Setup may generate a value when it is
blank and writes it back to `.env`.

| Variable | Why it is bootstrap |
| --- | --- |
| `INSTANCE_SECRET` | Convex admin key material; the legacy local-key fallback. |
| `BETTER_AUTH_SECRET` | Signs sessions. Changing it invalidates every session. |
| `AULORA_ENCRYPTION_KEY` | Local master key (KEK): the root of data confidentiality. |
| `AULORA_KEK_WRAPPED` | Master key wrapped by an external key manager, when one is used. |
| `AULORA_ENCRYPTION_ENABLED` | Encryption safety switch; only the exact value `false` disables sealing. |
| `VAULT_ADDR`, `VAULT_TOKEN`, `AWS_KMS_KEY_ID`, `GCP_KMS_KEY_NAME`, `EKM_PROXY_URL`, `EKM_PROXY_TOKEN` | Key-manager credentials needed to unwrap the master key before sealed rows can be read. Required only for the selected provider. |
| `SITE_URL`, `CONVEX_CLOUD_ORIGIN`, `CONVEX_URL`, `CONVEX_SITE_ORIGIN`, `TRUSTED_ORIGINS` (catalogue names: `SITE_URL`, `CONVEX_CLOUD_URL`, `CONVEX_SITE_URL`, `TRUSTED_ORIGINS`) | Public origins and allowed callbacks. A wrong value locks clients out of sign-in. |
| `INSTANCE_NAME`, `WORKSPACE_NAME` | Instance identity. |
| `SETUP_TOKEN` | Optional automation override for the printed first-run claim token. Setup otherwise issues and prints one; the plaintext is never stored in the database or the deployment environment. A re-run reuses a live token; `SETUP_TOKEN_ROTATE=true` on the setup container replaces and prints a new one. |
| `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME` | Legacy/automated seeding only. New installs register the owner in the app, so these are commented in `.env.example`. Set both credentials or neither. |
| `POSTGRES_*`, `DO_NOT_REQUIRE_SSL`, `MINIO_ROOT_*`, `AWS_REGION`, `S3_ENDPOINT_URL`, `AWS_S3_*`, `S3_STORAGE_*` | Database and object storage the backend needs before it becomes healthy. |
| Host ports (`WEB_PORT`, `CONVEX_API_PORT`, `CONVEX_SITE_PORT`, `DASHBOARD_PORT`, `POSTGRES_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `VAULT_PORT`, `PUSH_RELAY_PORT`, `LIVEKIT_PORT`) | Compose interpolation only; they do not reach application code. |
| `COMPOSE_PROJECT_NAME` | Compose project name; optional but safest to pin. |

## Deploy-time tier

These stay in the deployment environment. They are either read before any
request can consult the database (module load), or owned by a host-side tool
that the backend cannot change at runtime.

A prefix such as `APNS_*` covers every variable with that prefix; the generated
public reference lists each one individually. Anything not listed as
`overridable` is deploy-time by default.

| Area | Variables | Why it cannot be a live UI override |
| --- | --- | --- |
| Bot JWT provider | `BOT_JWT_PUBLIC_JWK`, `BOT_JWT_PRIVATE_JWK`, `BOT_RUNNER_TOKEN` | `auth.config.ts` reads the public JWK when the deployment's auth config is built; the runner token is a container credential. |
| Transcription engine | `TRANSCRIBER_TOKEN`, `TRANSCRIBER_URL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, `TRANSCRIBER_MAX_STREAMS`, `TRANSCRIBER_MEMORY_LIMIT`, `TRANSCRIBER_CPUS` | The optional `transcriber` container and the Convex action that asks it to download a model read these at start. The token is a shared secret; the model itself is chosen in the Addons card. |
| EKM engine plumbing | `AULORA_EKM_PROVIDER`, `AULORA_EKM_KEY_ID`, `AULORA_ENCRYPTION_KEY_VERSION`, `VAULT_TRANSIT_MOUNT`, `VAULT_NAMESPACE` | `crons.ts` selects the key-unwrap cron from the provider at module load; the key version is part of every envelope header. Rotate with a redeploy. |
| Updates | `AULORA_AUTO_UPDATE`, `AULORA_UPDATE_CHANNEL`, `AULORA_UPDATE_MANIFEST_URL`, `AULORA_UPDATE_GITHUB_REPO`, `AULORA_UPDATE_PROVIDER`, `AULORA_COOLIFY_*` | The host updater, not Convex, reads these. |
| Backups | `BACKUP_TOKEN`, `BACKUP_HOUR_UTC`, `BACKUP_ENABLED`, `BACKUP_BUCKET`, `BACKUP_RETENTION` | The backup runner container reads them. |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | A stable key pair generated by setup; rotating it invalidates subscriptions. |
| Push providers | `PUSH_RELAY_URL`, `PUSH_RELAY_TOKEN`, `AULORA_SERVER_ID`, `APNS_*`, `FCM_*`, `UNIFIEDPUSH_ENABLED` | Relay and provider credentials live in the relay container. The **Push relay** section owns the enable switch, URL and server id that Convex can change. |
| Email | `AULORA_EMAIL_PROVIDER`, `AULORA_EMAIL_FROM`, `RESEND_API_KEY`, `SMTP_*` | The **Email** section owns the runtime configuration; these are its deployment fallbacks and the private bridge's credentials. |
| Uploads and rate limits | `UPLOAD_MAX_BYTES`, `UPLOAD_RATE_*`, `SEND_RATE_*`, `INVITE_RATE_*`, `INVITE_PENDING_LIMIT`, `AUDIT_LOG_RETENTION_DAYS`, `DEVICE_RETENTION_DAYS`, `INVITE_REDEEM_RATE_*` | Bounded workload tuning. Storage limits are also in the **Storage** section. |
| Calls server | `TURN_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `TURN_SECRET` and the LiveKit secret are deployment credentials; the client-facing TURN URLs/TTL are overridable. |
| Platform policy | `AULORA_ALLOW_UI_ENV_OVERRIDES`, `AULORA_LICENSE_SERVER_URL`, `AULORA_LICENSE_PUBLIC_KEY` | The kill switch and the license authority are deployment policy; letting the UI change them would defeat their purpose. |
| Compatibility | `AULORA_MIN_CLIENT_VERSION`, `AULORA_RECOMMENDED_CLIENT_VERSION` | Advertised at deploy time; documented in the public reference. |
| Web server | `NGINX_CLIENT_MAX_BODY_SIZE`, `RUST_LOG` | Container start settings. |

## Overridable tier

The owner can set, replace and clear these keys from **Instance admin →
Environment**. Secrets are write-only: the panel reports only source,
set/not-set and last-updated time. The complete list is:

| Integration | Keys |
| --- | --- |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` |
| Single sign-on (OIDC) | `OIDC_DISPLAY_NAME`, `OIDC_ISSUER`, `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_TRUST_EMAIL`, `OIDC_GROUP_CLAIM`, `OIDC_GROUP_ROLE_MAP` |
| Local auth | `AUTH_LOCAL_ENABLED`, `AUTH_LOCAL_SIGNUP`, `AUTH_MIN_PASSWORD_LENGTH`, `AUTH_RATE_LIMIT_MAX` |
| Calls | `AULORA_ICE_SERVERS`, `TURN_URLS`, `TURN_TTL_SECONDS`, `AULORA_CALL_ALONE_TIMEOUT_SECONDS` |

The effective local password minimum is available at
`server.publicConfig.auth.local.minPasswordLength`. It is deliberately **not**
published in the `/.well-known/aulora.json` discovery document, whose strict key
set older clients validate; setup screens read the live config and fall back to
8 when an older backend does not report it.

Overridable keys are absent or commented in `infra/docker/.env.example` and are
not given empty defaults by compose. An operator who wants deployment-level
credentials can still set them: the value is read through the effective
environment and reported as `environment` (never displayed).

## Precedence

1. A UI override wins over the deployment environment for an overridable key.
2. When no override row exists, or the owner clears it, the deployment
   environment value applies.
3. Bootstrap and deploy-time keys ignore override rows entirely.
4. Credential groups are all-or-nothing. Once any member of a group (OIDC or a
   social provider's id and secret) is overridden, members without an override
   stop inheriting the deployment value, so a deployment secret is never paired
   with an owner-chosen endpoint or client id.

This is implemented in `buildEffectiveEnv` / `resolveEnvOverrides`
(`packages/convex/convex/lib/envOverrides.ts`) and covered by
`packages/convex/test/envCatalog.test.ts` and
`packages/convex/test/envOverrides.test.ts`. Auth, public config, instance
overview and TURN credentials read the effective environment, so a change
applies on the next request without a restart.

## Security properties

- Values are sealed with the `aulora-sse-v1` envelope before storage; the
  envelope header names the master-key version, so rotation keeps old rows
  readable.
- No query, mutation, action, subscription, log, error or audit row returns a
  secret value or an environment-sourced value. The panel returns a saved
  non-secret UI value for editing; secrets are only reported as set. Audit rows
  carry key names, actor and time only.
- The panel is owner-only, enforced by `requireInstanceAdmin` on every read and
  write, rate-limited, and refuses writes while
  `AULORA_ALLOW_UI_ENV_OVERRIDES=false`.
- The repository has no recent re-authentication/step-up mechanism today. The
  owner check is the only authority gate; this limitation is intentional and
  documented here instead of implying a step-up that does not exist.
- The web panel covers every overridable key, grouped by integration, with a
  first-run prompt when no OAuth/OIDC provider is configured. The mobile client
  has no instance-admin environment screen, so mobile owners use the web panel.

## Verification

- `bun run --cwd apps/docs test` checks that the generated reference lists every
  catalog key and preserves tiers.
- `node --test infra/docker/setup/test/*.test.mjs` checks that the shipped
  `.env.example` does not set an overridable key and that compose files do not
  give them non-empty defaults.
- `bun run --cwd packages/convex test` covers precedence, validation, sealing,
  authorization, rate limits, audit shape and the kill switch.
- `bun run --cwd apps/web test` covers the panel and the first-run prompt.
