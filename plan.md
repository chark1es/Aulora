# Aulora: Self-Hosted Team Chat

Sep 25, 2026 · [Charles](Charles) Nguyen

## Name and pitch

**Aulora** (pronounced aw-LOR-uh) is a coined name from Latin *aula*, the hall where a community gathered, and *ora*, from the root for speech. Together: the hall where your team talks. It is short, easy to say, professional enough for a company's IT page, and soft enough to sit next to blobatar faces.

One-line pitch: *Secure team chat on your own server.*

- A search on Sep 25, 2026 found no app or software product named Aulora (only a Malaysian clothing line, a novel and a baby-name listing)
- Because it is coined, domains, store names and trademarks are far more likely to be free than any dictionary word
- Before committing: USPTO search in the software class, `aulora.app` / `aulora.chat` / `getaulora.com` domains, `@aulora` npm and GitHub orgs, reserve the App Store name early
- Bundle IDs: `app.aulora.ios`, `app.aulora.android`, URL scheme `aulora://`

## Goals and non-goals

Aulora v1 ships one Docker Compose stack that hosts exactly one workspace, and five clients that can each join many such servers.

**Goals**

- 100% self-hosted via `docker compose up`; the only outside dependency is the project's push relay for store-built mobile apps
- One server = one workspace; clients show a server rail so a person can be in several workspaces at once, like Discord
- Clients are thin: every client asks for a server URL on first launch and stores it
- Channels, DMs, group DMs, threads, reactions, file and image uploads, full history
- Discord-style roles with per-channel permission overrides
- OAuth and OIDC sign-in, plus local email/password as a fallback
- Live updates everywhere (typing, presence, unread counts, edits)
- Real notifications: desktop, web push, iOS and Android push
- Server-side encryption on every channel, DM and file, with a locally generated master key (`AULORA_ENCRYPTION_KEY`) by default and external key managers as an optional upgrade
- Light and dark themes, blobatars as the default avatar
- Free for personal and noncommercial use; paid license for businesses

**Non-goals for v1**

- Voice and video calls
- Multiple workspaces on one server, and federation between servers
- Slack or Mattermost import (post-v1)
- A hosted SaaS offering

## Platforms and tech stack

Convex is the backend, Expo covers iOS and Android, and one React DOM app powers both web (Vite SPA) and desktop (Tauri 2).

| Target | Tech | Why |
| --- | --- | --- |
| Backend | Convex (self-hosted) | Reactive queries give live updates for free; runs in Docker |
| iOS, Android | Expo (React Native), Expo Router | Native feel, native push, shared TS with the rest of the repo |
| Web | Vite + React SPA, TanStack Router | Convex is client-driven, so SSR adds little; ships as static files behind Caddy |
| macOS, Windows, Linux | Tauri 2 wrapping the web app | Native webview, small binaries, native menus, tray, notifications, deep links, OS keychain |
| Auth | Better Auth on Convex | Generic OAuth and OIDC plugins, email/password, sessions |
| Crypto | AES-256-GCM envelope encryption with HKDF-derived per-scope DEKs; KEK derived from a locally generated `AULORA_ENCRYPTION_KEY` by default, with optional external custody (Vault/AWS KMS/GCP KMS/HTTP proxy) | Server-side encryption with a zero-dependency default and pluggable key custody and versioned rotation |
| Styling | Tailwind (web/desktop), NativeWind (mobile), shared token package | One palette, two renderers |
| Tooling | Bun, Turborepo, Biome | Matches existing workflow |

The macOS app is the Tauri build with macOS-specific polish: vibrancy sidebar, native menu bar, Dock badge for unread count, and `Cmd+K` quick switcher.

## Monorepo layout

One Bun + Turborepo workspace; apps stay thin and everything reusable lives in `packages/`.

```
aulora/
  apps/
    web/            Vite + React SPA (also the Tauri frontend)
    desktop/        Tauri 2 shell (src-tauri/ Rust: native shell, notifications, tray, deep links)
    mobile/         Expo app (iOS + Android)
  packages/
    convex/         schema, queries, mutations, actions, http routes, crons, server-side encryption
    core/           shared hooks + client logic (server URL store, unread math, permission checks)
    ui-web/         React DOM components (message list, composer, sidebar)
    ui-native/      React Native components mirroring ui-web
    tokens/         colors, radii, spacing, type scale -> Tailwind + NativeWind configs
    avatars/        Blobatar wrapper for web + native
    config/         tsconfig, biome, tailwind presets
  infra/
    docker/         docker-compose.yml, Caddyfile, .env.example
    push-relay/     optional small service for APNs/FCM (see Notifications)
  docs/
```

- `packages/convex` is deployed to the self-hosted backend with the Convex CLI (`CONVEX_SELF_HOSTED_URL` + admin key)
- Permission logic lives in `packages/core` and is re-checked server-side in Convex; the client copy only hides UI

## Architecture and self-hosting

A single `docker compose up` starts five core services (plus two optional) behind Caddy with automatic HTTPS; operators only edit `.env` and point DNS.

| Service | Image / source | Role |
| --- | --- | --- |
| `caddy` | caddy:2 | TLS, routes `api.`, `site.`, `dashboard.` and the web app |
| `convex-backend` | Convex self-hosted backend | Database, functions, realtime sync, file storage (API on 3210, HTTP actions on 3211) |
| `convex-dashboard` | Convex dashboard | Admin UI on 6791, keep behind auth or VPN |
| `postgres` | postgres:17 | Default storage for Convex; SQLite is not used, so small and large installs run the same stack |
| `minio` (optional) | MinIO or any S3 | Uploads, exports, snapshots when files outgrow the local volume |
| `web` | built from `apps/web` | Static SPA served by Caddy |
| `push-relay` (optional) | built from `infra/push-relay` | Holds APNs/FCM credentials for mobile push |
| `vault` (optional) | HashiCorp Vault | Optional/advanced external key manager holding the KEK via Transit; the default is a locally generated `AULORA_ENCRYPTION_KEY`, with AWS/GCP KMS or an HTTP proxy as alternatives |

- Convex serves the API on port 3210, HTTP actions on 3211 and the dashboard on 6791, and can use Postgres and S3 instead of the defaults ([self-hosting guide](https://github.com/get-convex/convex-backend/tree/main/self-hosted), [own infra](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/hosting_on_own_infra.md))
- First-run flow: `docker compose up -d`, run the admin key script, then `bun run deploy:convex` from `infra/`
- Ship a `aulora` CLI container that does first-run setup: generates `INSTANCE_SECRET`, admin key, VAPID keys and the local encryption master key `AULORA_ENCRYPTION_KEY`, names the workspace and creates its owner account
- Backups: nightly `convex export` to the S3 bucket plus Postgres dumps
- Well-known endpoint `https://site.<domain>/.well-known/aulora.json` returns workspace name, icon seed, version, auth providers and the Convex URL, so clients only need the base domain

## Server connection and auth

Every client starts at a "Connect to a server" screen, then signs in with whatever providers that server enabled.

**Connecting**

1. User enters `chat.acme.com`
2. Client fetches `/.well-known/aulora.json`, shows the workspace name and blobatar icon, confirms version compatibility
3. Client stores the server profile (URL, Convex URL, providers); each server is one workspace, and the client lists all joined servers in a Discord-style rail
4. Deep links: `aulora://connect?server=chat.acme.com` for invite links on mobile and desktop

**Auth**

- Better Auth running inside Convex via the `@convex-dev/better-auth` integration, which issues the JWT Convex validates
- Providers configured by the admin in `.env` or the admin panel:
  - Local email + password (with optional TOTP 2FA and passkeys)
  - Built-in OAuth: GitHub, Google, Microsoft, Apple (required on iOS if any social login exists)
  - Generic OIDC via discovery URL: Keycloak, Authentik, Authelia, Okta, Zitadel, Entra ID
- OIDC group claims map to Aulora roles (for example `aulora-admins` -> Admin) so SSO shops manage access in their IdP
- Native flow: Authorization Code + PKCE in the system browser (`expo-auth-session`, Tauri opener), redirect back via the `aulora://` scheme
- Admin toggles: disable local signup, invite-only, allowed email domains
- Risk to verify early: Better Auth's SSO and OIDC-provider plugins have had bundling issues inside Convex ([issue #5314](https://github.com/better-auth/better-auth/issues/5314)); spike the generic OAuth plugin in week 1

## Workspaces, roles and permissions

Permissions work like Discord: a member's power is the union of their roles' bitflags, then per-channel overrides allow or deny on top, and higher roles can only manage lower ones.

**Levels**

- **Instance admin**: the operator account from setup: auth providers, storage quotas, backups, push relay settings (usually the same person as the owner)
- **Workspace owner**: one per server, cannot be removed except by transfer
- **Roles**: ordered list per workspace with name, color (tints the blobatar ring and username), position, permission bitfield, `mentionable`, `hoisted` (shown separately in the member list)
- `@everyone` role: the baseline every member inherits

**Permission flags (v1)**

| Group | Flags |
| --- | --- |
| General | View channel, Manage channels, Manage roles, Manage workspace, View audit log, Create invites, Manage emoji |
| Members | Kick, Ban, Timeout, Change own nickname, Manage nicknames |
| Messages | Send messages, Send in threads, Create threads, Attach files, Embed links, Add reactions, Mention [everyone,](everyone,) Manage messages, Pin messages, Read history |
| Special | Administrator (bypasses all checks except hierarchy) |

**Resolution order**

1. Owner or Administrator -> allow all
2. Start from `@everyone` role flags, OR in every role the member holds
3. Apply channel category overrides, then channel overrides: role denies, role allows, then member-specific deny and allow
4. Hierarchy check for moderation actions (target's top role must be below actor's)

- Every Convex mutation calls `requirePermission(ctx, channelId, FLAG)`; queries filter out channels without View channel
- Audit log table records role changes, kicks, bans, deletions, setting changes

## Messaging features

v1 covers the everyday Slack surface. The server seals content with server-side encryption before it is stored, so features that need message text (search, moderation) can run on the server over decrypted content.

- **Channels**: public, private, read-only announcement; grouped into collapsible categories; archive and unarchive
- **DMs and group DMs** (up to 10 people)
- **Threads**: reply in thread with "also send to channel" option
- **Messages**: Markdown subset, code blocks with highlighting, edits (with "edited" marker), deletes, reactions, pins, mentions (`@user`, `@role`, `@here`, `@everyone`), link previews
- **Uploads**: drag and drop, paste, camera on mobile; images get thumbnails and blurhash placeholders; per-workspace size limit; every file and thumbnail is sealed server-side (AES-256-GCM) before it is stored
- **History**: infinite scroll with Convex paginated queries, jump to date, jump to first unread, per-channel read cursor
- **Search**: server-side full-text index over decrypted content; the client keeps a local cache of recent history for offline use
- **Presence and typing**: online, idle, DND, custom status with emoji; typing indicators via a short-TTL table
- **Drafts**: per-channel, synced across a user's own devices (sealed server-side)
- **Offline**: optimistic sends with a local outbox and retry

## Encryption and security

Every channel, DM, thread, reaction, edit and file is encrypted by the server with server-side envelope encryption. Nothing readable is stored at rest; the server decrypts only for authorized clients, and the root key (the KEK) is never written to the database or a backup. By default the KEK is derived from a locally generated `AULORA_ENCRYPTION_KEY`; an external key manager is an optional/advanced upgrade.

**The envelope**

- Algorithm: AES-256-GCM with a 12-byte random IV and a 128-bit authentication tag
- Each sealed value carries a header naming its key version, so reads survive a rotation while writes always use the current version; older values are re-sealed lazily
- The per-record data key (DEK) is derived with HKDF-SHA256 from the master key, the workspace salt and the record scope
- Scope, record id and key version are bound into the GCM additional data, so a ciphertext cannot be moved to a different scope or record without failing authentication
- Files are sealed server-side too, with the same envelope and a per-file DEK

**Key management**

- The master key (KEK) is the root of confidentiality. The default `local` provider derives it from a base64 32-byte `AULORA_ENCRYPTION_KEY` that `setup` generates once and persists in `.env`, so a default install needs no extra services; `INSTANCE_SECRET` is only a legacy fallback when that key is unset
- External key managers (HashiCorp Vault Transit, AWS KMS, GCP KMS or a small HTTP unwrap proxy) are an optional/advanced upgrade for custody across nodes; the provider interface accepts them without code changes
- Remote providers are unwrap-only: the server stores `AULORA_KEK_WRAPPED` (the KEK encrypted by the manager) and asks the manager to unwrap it from an action/setup/cron; key material stays in memory and never in a query or mutation
- Provider, key id and key version are configurable (`AULORA_EKM_PROVIDER`, `AULORA_EKM_KEY_ID`, `AULORA_ENCRYPTION_KEY_VERSION`); bump the version to rotate the KEK and mark the new version active
- `encryptionKeys` rows record which version exists, which provider guards it and whether it is active — never key material
- Losing the KEK makes the existing data unreadable, so it must be backed up separately from the database (the `AULORA_ENCRYPTION_KEY` in `.env`, or the EKM's KEK if you upgrade to one); the database, its dumps and the `convex export` hold only ciphertext

**Why realtime stays fast**

- Decrypting one value is a cheap in-process AES-GCM operation, so send and receive latency is effectively unchanged
- Convex still does what it is good at: ordering, pagination, subscriptions, read cursors and permissions all work on metadata (channel, author, timestamps, IDs)
- Search and moderation run server-side over decrypted content, so they cover all history without a per-device index
- Notification text and mention detection run server-side

**What stays true**

- Data at rest is ciphertext by design; Postgres and S3 encryption at rest stay on as defense in depth
- The push relay still forwards only content-free wakeups (no message text), because the app fetches and decrypts content from its own server
- Transport is TLS end to end at the edge

**Hardening checklist**

- [ ] TLS 1.3 via Caddy, HSTS, WebSocket over TLS only
- [ ] Rate limits on auth, message send and upload endpoints
- [ ] Upload size caps; EXIF stripping before sealing
- [ ] CSP on web and in the Tauri webview; no remote code in the desktop shell
- [ ] Session revocation and a device list per user
- [ ] KEK custody runbook: backup, rotation and restore drills
- [ ] Third-party security review before 1.0

## Realtime and notifications

Live updates come from Convex reactive queries; notifications are the one place a fully self-hosted setup still needs Apple and Google, because iOS and stock Android only deliver push through APNs and FCM.

**Realtime (Convex subscriptions)**

- Messages, reactions, edits, unread counts, channel list and member list are all `useQuery` subscriptions
- Presence heartbeat every 30 s via mutation; a cron marks stale sessions idle/offline
- Typing: write to a `typing` table with an expiry, clear on send or timeout
- Reconnect handling: show a subtle "Reconnecting" bar in the accent color

**Notifications by platform**

| Platform | Delivery | Self-hosted? |
| --- | --- | --- |
| Desktop (Tauri) | Native OS notifications from the running app, Dock/taskbar badge | Yes |
| Web | Web Push with VAPID keys generated at setup, service worker | Yes (browser vendor push service in the path) |
| iOS | APNs, sent directly from `push-relay` with the operator's Apple key | Needs an Apple developer account |
| Android | FCM from `push-relay`; optional UnifiedPush / ntfy for de-Googled phones | FCM needs a Firebase project; UnifiedPush is fully self-hosted |

- Skip Expo's hosted push service to stay self-hosted; use `expo-notifications` only for tokens and display
- Official App Store builds need a shared push relay run by the Aulora project (like Mattermost's HPNS): it holds the APNs key and FCM credentials for the official apps and forwards only content-free wakeups; anyone building their own apps can point them at their own relay
- Notification preferences: per workspace and per channel (all, mentions, nothing), keywords, DND schedule, mute until
- Server logic: a Convex action on new message resolves recipients, skips anyone active in that channel, respects prefs, batches within 10 s
- Push payloads carry only an opaque server ID, channel ID and message ID; the app decrypts and rewrites the notification locally (iOS Notification Service Extension, Android data message)

## Design system

The reference look is native macOS, not a generated dashboard: flat panes with hairline dividers, Apple system neutrals for surfaces, and Ember kept as a signal, not a wash. No ornamental dot grid and no floating cards; the window reads as one object, with translucency reserved for the sidebar and toolbar over live content.

**Palettes**

| Token | Dark (Loam) | Light (Linen) | Use |
| --- | --- | --- | --- |
| `bg` | #1C1C1E | #F2F2F7 | Window canvas behind the panes |
| `grid-dot` | #2C2C2E | #E5E5EA | Reserved; no dot grid is drawn by default |
| `surface-1` | #242426 | #F7F7FA | Sidebar, server rail |
| `surface-2` | #2C2C2E | #FFFFFF | Content, message rows, composer |
| `surface-3` | #3A3A3C | #EFEFF4 | Inputs, hover, selected rows, code blocks |
| `border` | #38383A | #D9D9DE | Hairlines, pane dividers, card outlines |
| `text` | #F5F5F7 | #1C1C1E | Primary text |
| `text-muted` | #A6A6AE | #636366 | Timestamps, meta, placeholders |
| `accent` (Ember) | #E4571C | #C2410C | Primary buttons, focus ring, unread count |
| `accent-soft` | #E4571C24 | #C2410C14 | Mentions, selected icon tint, own-bubble surface |
| `secondary` (Moss) | #4CD964 | #248A3D | Online presence, success, encryption lock icon |
| `danger` | #FF6B6B | #D70015 | Delete, errors, DND |

**Shape and type**

- Radii: 12px cards and panels, 10px inputs and buttons, 16px message bubbles, 999px pills; hairline 1px borders, no heavy shadows
- UI font: the platform system face (SF Pro on Apple platforms, Segoe UI Variable on Windows, Inter/Geist elsewhere); metadata, file names and code in the platform mono face (SF Mono, Geist Mono, JetBrains Mono)
- Chat layout is flat rows, not bubbles, on desktop and web; mobile uses softly rounded grouped rows
- Accent discipline: Ember marks the primary action, focus, unread and mentions. Selection uses `surface-3` plus a 3px accent leading bar, not a full accent fill. Own messages use the `accent-soft` tint so a long conversation never becomes a wall of orange
- The sidebar and conversation header are translucent materials (`material-chrome`, `backdrop-filter: blur(20px)`); content surfaces stay opaque
- "Thinking" style particle spinner reused as the reconnecting and loading indicator

**Blobatars**

- [Blobatar](https://blobatar.dev) generates a deterministic geometric avatar from any string, is MIT licensed, has no dependencies and ships a React component (`@blobatar/react`)
- Seed = stable user ID, not the display name, so avatars survive renames
- Web and desktop: `<Blobatar name={user.id} animate="hover" />`; mobile: render the core package's SVG output through `react-native-svg` (verify the core API exposes a raw SVG string)
- Uploaded profile photos are optional; blobatar is the default and the fallback
- Server icons in the rail and empty states use blobatars too; the role color draws a 2px ring around the avatar
- The Aulora logo: a soft arched doorway, the entrance to the hall, drawn as a single blobatar-style shape in Ember with a small speech-dot inside

## Data model sketch

These Convex tables cover v1; since one server is one workspace, no table needs a `workspaceId`. Better Auth manages its own user, session and account tables through its component. Every `*Ciphertext` field holds a server-sealed `aulora-sse-*` envelope, opened with the master key only for authorized clients.

| Table | Key fields | Indexes |
| --- | --- | --- |
| `server` | singleton: name, iconSeed, ownerId, settings, license key | none |
| `members` | userId, nickname, roleIds\[\], joinedAt, timeoutUntil | by\_user |
| `roles` | name, color, position, permissions (bigint bitfield), hoisted, mentionable | by\_position |
| `categories` | name, position, overrides\[\] | by\_position |
| `channels` | categoryId, kind (text, announcement, dm, group\_dm), nameCiphertext, topicCiphertext, overrides\[\], archived | by\_category, by\_dm\_key |
| `messages` | channelId, authorId, ciphertext, threadRootId, attachmentIds\[\], mentionUserIds\[\], editedAt, deletedAt | by\_channel\_created, by\_thread |
| `reactions` | messageId, userId, emojiCiphertext | by\_message |
| `readStates` | userId, channelId, lastReadMessageId, mentionCount | by\_user\_channel |
| `files` | storageId, uploaderId, sizeBytes, sealed metadata (name, mime, dimensions, blurhash) | by\_uploader |
| `devices` | userId, platform, pushToken, lastSeen | by\_user |
| `encryptionKeys` | keyVersion, provider, kekId, status (active/retired), createdAt, retiredAt | by\_key\_version |
| `presence` | userId, status, customStatusCiphertext, lastHeartbeat | by\_user |
| `typing` | channelId, userId, expiresAt | by\_channel |
| `notificationPrefs` | userId, scope (server or channel), level, muteUntil, keywordsCiphertext | by\_user\_scope |
| `invites` | code, createdBy, maxUses, uses, expiresAt | by\_code |
| `auditLog` | actorId, action, targetId, meta, at | by\_at |

- `mentionUserIds[]` is plaintext metadata by design so the server can count mentions and route push; the mention text itself is sealed server-side

## Milestones

Seven phases take Aulora from a compose file to beta; the server-side encryption layer and its `local` key provider go in with core chat, and external key managers land before beta.

| Phase | Scope | Done when |
| --- | --- | --- |
| 0. Spikes | Convex self-hosted + Better Auth generic OIDC, server-side envelope encryption + EKM provider spike, Blobatar in React Native | All three risks proven or replaced |
| 1. Foundation | Monorepo, tokens, compose stack, server-connect screen, local + OIDC login | Sign in on web from a fresh `docker compose up` |
| 2. Core chat | Server-side envelope encryption with the local provider, messages, threads, reactions, server-sealed uploads, read state, server-side search | A team uses web daily and the database holds only ciphertext |
| 3. Roles | Role editor, bitfield checks in every mutation, channel overrides, audit log, invites | Permission test suite passes |
| 4. Clients | Tauri desktop (macOS polish first), Expo iOS/Android, deep links, desktop + web push | Same account works on all five clients |
| 5. External EKM + mobile push | Vault/AWS KMS/GCP KMS/HTTP providers, key versioning and rotation, project push relay for APNs/FCM | A deployment unwraps its KEK from an external key manager and mobile push works |
| 6. Beta | Admin panel, backups, license key check, docs site, one-command installer | Outside tester self-hosts without help |
|  |  |  |

## Open questions

**Decided**

- Name: Aulora
- Mobile push: the project runs its own relay for official store builds
- Encryption: server-side AES-256-GCM envelope encryption on every channel, DM and file, with the master key (KEK) derived from a locally generated `AULORA_ENCRYPTION_KEY` by default; external key managers (Vault, AWS/GCP KMS or an HTTP proxy) are optional
- Tenancy: one workspace per server; clients join many servers
- Database: Postgres
- License: free for personal and noncommercial use, paid for commercial use (see Licensing)

**Still open**

- [ ] Trademark and domain check for Aulora
- [ ] Pricing model for commercial licenses: per server, per seat, or flat annual
- [ ] Should the push relay be free for noncommercial servers and metered for licensed ones?
- [ ] Max message and upload volume per workspace to size Postgres and S3
- [ ] KEK rotation runbook: drain, re-seal old key versions, retire a version
- [ ] Which external key managers to prioritize beyond Vault (AWS KMS, GCP KMS, HTTP proxy)

## Licensing

Aulora uses a dual license: the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) for everyone, and a paid commercial license for businesses.

- PolyForm Noncommercial allows personal use (hobby, study, private entertainment) and use by charities, schools, public research, public safety and government bodies
- Any company or for-profit team running Aulora for work needs the commercial license
- It is source-available, not OSI open source; say so plainly in the README
- Contributors sign a CLA so the project can keep selling commercial licenses
- Enforcement is by license terms, not DRM; the admin panel just shows license status and a nag for unlicensed commercial installs
- Check third-party licenses (Convex backend, Better Auth, Blobatar is MIT) for compatibility before release

## Sources

- [Convex self-hosting README](https://github.com/get-convex/convex-backend/tree/main/self-hosted)
- [Convex: hosting on your own infrastructure](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/hosting_on_own_infra.md)
- [HashiCorp Vault Transit secrets engine](https://developer.hashicorp.com/vault/docs/secrets/transit)
- [AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/overview.html)
- [Google Cloud KMS](https://cloud.google.com/kms/docs)
- [Blobatar](https://blobatar.dev)
- [Better Auth issue #5314 (OIDC/SSO plugins in Convex)](https://github.com/better-auth/better-auth/issues/5314)

* [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
