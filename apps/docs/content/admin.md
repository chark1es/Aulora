# Admin panel

Aulora has two admin surfaces.

## Workspace admin

Opened from **Workspace settings** in the sidebar. It covers the things a
workspace owner and moderators manage: roles and permission bitfields, member
moderation (kick, ban, timeout, nicknames), per-channel and per-category
overrides, invites and the allowlist, audit log and workspace access policy (signup,
invite-only, allowed email domains).

Each section appears only when the viewer holds the matching permission, and
every mutation is re-checked on the server. The client copy of the permission
logic only hides UI.

## Invites

The **Invites** section (and the same flow on a new member's device) controls
how people get into an invite-only workspace.

Ways to invite:

- **Link** — a web link (`/invite/<code>`) you share anywhere. Unlimited uses by
  default.
- **Email** — enter an address and Aulora emails a one-time link. It works once,
  only for the account that signs in with that address, and needs email delivery
  set up under Instance admin.
- **Code** — a short code such as `7QXM-2KD9-TV4B`. A new member signs in, sees
  the join screen and types it in; it is one-time by default.

Every invite can have an expiry (an hour to 30 days, a date you pick, or never;
the default is 7 days), a use limit (one time, a number, or unlimited), an
optional **Only for** address that limits it to one account, and a note that only
admins see. The plaintext link or code is shown once at creation; only a hash is
stored.

The history lists who created each invite, its method, expiry, uses, the address
it is limited to, and who joined with it. Active invites can be revoked (the link
stops working) and any invite can be deleted. The audit log keeps a record either
way.

**Allowlist** — add `person@example.com` or a whole domain, `@example.com`.
Someone who signs in with a matching address can join without an invite. If
their sign-in provider has verified the address they join straight away;
otherwise Aulora emails a six-digit code (valid 10 minutes, five tries) to prove
they own it. Removing an entry does not remove anyone who already joined.

Permissions: **Create invites** lets a role make invites and add allowlist
entries; **Delete invites** lets it revoke or delete invites and remove
allowlist entries. Either permission opens the section, so a role can be given
one without the other. Redeeming is limited to 10 attempts per person every 10
minutes so short codes cannot be guessed.

Existing roles that held Create invites do not gain Delete invites automatically;
grant it from the role editor where it is wanted.

## Addons

The Addons tab controls optional tools. Kanban and Notes are off by default and require Manage workspace to enable. Grant their separate role permissions before inviting members to use them. See [Kanban](kanban.md) for board permissions, timers, attachments and GitHub connections, and [Notes](notes.md) for folders, tags, search and history.

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
- **Encryption** — the EKM provider (default `local`), the KEK id and the active
  key version, and whether a master key is configured. Key-version rows show
  which versions exist and which is active; no key material is ever shown. Set
  the provider in `infra/docker/.env` and re-run `setup` to change it; the
  external providers are optional and advanced.
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
