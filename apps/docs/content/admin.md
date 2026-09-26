# Admin panel

Aulora has two admin surfaces.

## Workspace admin

Opened from **Workspace settings** in the sidebar. It covers the things a
workspace owner and moderators manage: roles and permission bitfields, member
moderation (kick, ban, timeout, nicknames), per-channel and per-category
overrides, invite links, audit log and workspace access policy (signup,
invite-only, allowed email domains).

Each section appears only when the viewer holds the matching permission, and
every mutation is re-checked on the server. The client copy of the permission
logic only hides UI.

## Instance admin

Opened from **Instance admin** in the sidebar, visible only to the operator
account created by first-run setup (the workspace owner). This is where
instance-level concerns live:

- **Overview** — version, member/channel/device/file counts, storage used, the
  current license state and the last backup.
- **Auth providers** — which local, OAuth and OIDC providers are configured, and
  the local signup state. Providers come from the deployment environment; set
  credentials in `infra/docker/.env` and re-run `setup`. Secrets are never
  shown, only whether each provider is configured.
- **Storage** — the total upload quota (`0` means unlimited) and the largest
  single upload. Both are validated server-side.
- **Backups** — enable or disable the nightly intent, request a backup now, and
  see recent runs with their status, size and S3 location.
- **Push relay** — enable the optional mobile push relay and set its URL and
  opaque server id. The shared relay token stays in the deployment environment.
- **License** — the license status screen: tier, licensee, expiry and a masked
  key, with a nag when no commercial license is present.

## First-run setup

The operator account is created by the `setup` container from `.env`
(`OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME`). To change instance settings
later, use the panel; to change auth credentials or the public origin, edit
`.env` and re-run `docker compose run --rm setup`.
