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

### Roles and the member list

The role editor sets a role's colour, position and permissions. As you pick a
colour, it shows the role name on a light and a dark theme preview, with the
contrast ratio and a readable, low or failing label for each. One colour often
cannot be readable on both themes, so when a theme falls short the editor offers
a **Make readable on light** or **Make readable on dark** button. It nudges the
brightness and keeps the hue, and leaves a theme that already passes alone. The
warnings never block saving. A role can also
be set to **display its members separately**: its holders then get their own
section at the top of the member list, above Online and Offline, titled in the
role's colour. Following the existing presence split, only online members appear
under a role section; offline members always fall under Offline. A member who
holds several separate roles appears once, under their highest one, and the
`@everyone` role is never split out.

### Channels and categories

Editing a channel opens a **Role permissions** section where the viewer can set
each channel-scoped permission for a role to inherit, allow or deny. It appears
to viewers who have the Manage channels permission and can manage at least one
role. The server also enforces the role hierarchy: you cannot grant a permission
you do not hold, and you cannot change overrides for a role above your own.

Category headers can be dragged to reorder them, the same way channels are
dragged. Reordering needs the Manage channels permission, and the new order is
stored server-side.

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

### Custom invite codes

A **Code** invite can use a random code or one you choose. Pick **Choose my own**,
type something memorable such as `WELCOME-TEAM` or `aulora2026`, and share it
like any other code.

Rules, checked in the form and again on the server:

- 6 to 32 characters after dashes are removed. Shorter codes are too easy to
  guess, so the minimum applies even to a one-time or expiring invite.
- Letters, digits, dashes (`-`) and underscores (`_`) only, with at least one
  letter or digit. Spaces, emoji and other punctuation are refused.
- Case, dashes and spaces do not matter when redeeming: `welcome-team`,
  `WELCOME TEAM` and `welcome-team` all find the same invite. Lookalike letters
  are folded the same way as generated codes, so `aulora2026` also opens with
  `au1ora2026`.
- The code must not already belong to an **active** invite. You can reuse a code
  once the previous invite is revoked, expired or used up; the old invite stops
  working and the new code takes over. The plaintext code is still shown only
  once, and only its hash is stored.

For a code people may share repeatedly, choose a longer phrase, allow multiple
uses, and give it an expiry. For one person, keep the default single use or add
an **Only for** address, which also limits it to that account.

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

The Addons tab controls optional tools. Kanban, Notes, Transcription, Guest calls and Scheduled calls are off by default and require Manage workspace to enable. Grant their separate role permissions before inviting members to use them. See [Kanban](kanban.md) for board permissions, timers, attachments and GitHub connections, [Notes](notes.md) for folders, tags, search and history, [Transcription](transcription.md) for the optional speech engine and summaries, [Guest calls](guest-calls.md) for links and the lobby, and [Scheduled calls](scheduled-calls.md) for the Scheduled tab. Bots have their own tab, described in [Bots](bots.md); it needs the Manage bots permission. Webhooks, which let other tools post into a channel, have their own tab too: see [Webhooks](webhooks.md).

Call-addon permissions are granted to no role by default. Owners and
administrators hold them implicitly.

| Permission | Allows |
| --- | --- |
| Start transcription | Start and stop transcription in a call the member is in. |
| View transcripts | Read transcripts and summaries, and request a re-summary. |
| Manage transcription | Configure the addon, download models, set the LLM endpoint/key and retention, and delete transcripts. |
| Create guest links | Create guest invite links for calls the member can join. |
| Manage guest access | Admit, deny or remove guests in any call, and revoke any link. |
| Schedule calls | Create, edit and cancel own scheduled calls. |
| Manage scheduled calls | Edit and cancel anyone's scheduled calls. |
| View scheduled calls | See the Scheduled tab, limited to calls the viewer is invited to or may join. Granted to `@everyone` once by the setup migration. |

## Instance admin

Opened from **Instance admin** in the sidebar, visible to workspace owners.
Owners are peers: every owner can open this panel, manage environment
overrides, backups, updates and other owners. This is where instance-level
concerns live:

- **Overview** — version, member/channel/device/file counts, storage used, the
  current license state and the last backup.
- **Auth providers** — which local, OAuth and OIDC providers are configured, and
  the local signup state. Providers come from the deployment environment or from
  overrides saved in the **Environment** section; set credentials in
  `infra/docker/.env` (or the Environment tab) and re-run `setup`. Secrets are
  never shown, only whether each provider is configured, and values that came
  from the deployment are hidden even from the owner. The **Email & password
  sign-in** switch turns local sign-in on or off at runtime (no redeploy); it is
  refused while no other provider is configured and enabled, so the instance can
  never be locked out, and first-run owner creation is never blocked by it. See
  [Disabling email & password sign-in](self-hosting.md#disabling-email-password-sign-in).
- **Environment** — every environment variable the app reads, in a table with
  where each value comes from (environment, overridden here, or unset), when an
  override was last updated. A lock icon marks a row that cannot be changed
  from here; hover it for the reason. Each provider's client id row shows the redirect URL to
  register with that provider (built from `SITE_URL`). Deployment values
  are never returned, secret or not; a saved secret is shown only as **Set**,
  never as a mask, prefix, suffix or length. The owner can override a curated
  set, reset it back to the deployment value, and add a custom OIDC provider
  without editing `.env`; a first-run prompt points to the provider rows when
  none is configured. Every save is validated, rate-limited and audited with key
  names only, and stored sealed with the server encryption key; secrets typed
  here are write-only. Bootstrap variables such as `BETTER_AUTH_SECRET`, the
  encryption keys and `SITE_URL` are read-only. Overriding any key in a
  credential group (OIDC, or a social provider's id and secret) stops that
  group's deployment values from applying, so a deployment secret is never
  paired with an endpoint the owner chose. Overrides take effect on the next
  request, with no restart. Set `AULORA_ALLOW_UI_ENV_OVERRIDES=false` in `.env`
  and re-run `setup` to disable the section. The
  [environment variables reference](environment-variables.md) lists every
  variable the app reads.
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

On a fresh instance the app shows **Set up your instance**. Copy the one-time
setup token from the `setup` container's logs, then register the first owner
account (name, email and a strong password) on that screen. The token is stored
server-side only as a hash, expires after 24 hours, and is deleted once the
claim succeeds. Re-run `docker compose run --rm setup` to rotate and print a new
one.

Automation can still seed the owner from `OWNER_EMAIL` / `OWNER_PASSWORD`, or
supply a `SETUP_TOKEN` override; existing instances with an owner never see the
setup screen. To change instance settings later, use the panel; to change the
public origin or the encryption configuration, edit `.env` and re-run setup.

## Owners

Owners can promote an existing member from **Members → member → Owner access →
Make owner**, and remove owner access from another owner the same way. Every
promotion and removal is confirmed in a dialog, audited with actor, target and
time, and rejected server-side if it would leave the workspace with no owner.
Bots and non-members can never be owners.

This release has no separate password re-authentication (step-up) prompt, so
promotion relies on an active owner session plus the confirmation dialog. The
target sees the Owner badge and the new permissions live; the app has no
generic account-event notification transport. Existing single-owner installations
keep working: the legacy `ownerId` remains populated with one of the owners for
older clients.
