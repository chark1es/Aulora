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
- End-to-end encryption on every channel, DM and file
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
| Crypto | MLS (RFC 9420) via `ts-mls`, OpenMLS in Tauri's Rust core as an option | Modern group E2EE standard |
| Styling | Tailwind (web/desktop), NativeWind (mobile), shared token package | One palette, two renderers |
| Tooling | Bun, Turborepo, Biome | Matches existing workflow |

The macOS app is the Tauri build with macOS-specific polish: vibrancy sidebar, native menu bar, Dock badge for unread count, and `Cmd+K` quick switcher.

## Monorepo layout

One Bun + Turborepo workspace; apps stay thin and everything reusable lives in `packages/`.

```
aulora/
  apps/
    web/            Vite + React SPA (also the Tauri frontend)
    desktop/        Tauri 2 shell (src-tauri/ Rust: keychain, notifications, tray, MLS option)
    mobile/         Expo app (iOS + Android)
  packages/
    convex/         schema, queries, mutations, actions, http routes, crons
    core/           shared hooks + client logic (server URL store, unread math, permission checks)
    crypto/         MLS wrapper, key storage adapters (web IndexedDB, Tauri keychain, Expo SecureStore)
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

- Convex serves the API on port 3210, HTTP actions on 3211 and the dashboard on 6791, and can use Postgres and S3 instead of the defaults ([self-hosting guide](https://github.com/get-convex/convex-backend/tree/main/self-hosted), [own infra](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/hosting_on_own_infra.md))
- First-run flow: `docker compose up -d`, run the admin key script, then `bun run deploy:convex` from `infra/`
- Ship a `aulora` CLI container that does first-run setup: generates `INSTANCE_SECRET`, admin key, VAPID keys, names the workspace and creates its owner account
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

v1 covers the everyday Slack surface, with every message and file encrypted on the sender's device; features that normally read message text on the server move to the client.

- **Channels**: public, private, read-only announcement; grouped into collapsible categories; archive and unarchive
- **DMs and group DMs** (up to 10 people)
- **Threads**: reply in thread with "also send to channel" option
- **Messages**: Markdown subset, code blocks with highlighting, edits (with "edited" marker), deletes, reactions, pins, mentions (`@user`, `@role`, `@here`, `@everyone`), link previews (fetched by the sender's client and sent encrypted)
- **Uploads**: drag and drop, paste, camera on mobile; images get thumbnails and blurhash placeholders; per-workspace size limit; every file and thumbnail is encrypted client-side before upload
- **History**: infinite scroll with Convex paginated queries, jump to date, jump to first unread, per-channel read cursor
- **Search**: local on-device index built as messages decrypt (SQLite FTS5 on mobile and desktop, IndexedDB on web); older history is backfilled in the background
- **Presence and typing**: online, idle, DND, custom status with emoji; typing indicators via a short-TTL table
- **Drafts**: per-channel, synced across a user's own devices as ciphertext
- **Offline**: optimistic sends with a local outbox and retry

## Encryption and security

Every channel, DM, thread, reaction, edit and file is end-to-end encrypted with MLS; the server stores and relays ciphertext and never holds a key that can read a message.

**Why realtime stays fast**

- Each message is one AES-GCM encryption with the channel's current MLS epoch key: microseconds on any modern device, so send and receive latency is unchanged
- Convex still does what it is good at: ordering, pagination, subscriptions, read cursors and permissions all work on metadata (channel, author, timestamps, IDs), not on message text
- MLS membership changes cost O(log n) per commit, so a 1,000-member channel re-keys in one small commit rather than 1,000 separate key sends
- Decryption happens in a worker (Web Worker on web and desktop, JSI module on mobile) so scrolling long history never blocks the UI

**How it works**

- Protocol: MLS (RFC 9420) with forward secrecy and post-compromise security
- Every channel and DM is an MLS group; each device is an MLS member with its own identity key
- Convex stores KeyPackages, encrypted commits, Welcome messages and ciphertext only
- Role or permission changes that remove View channel trigger an MLS Remove commit; joins trigger Add
- Public channels: any member with View channel can request to join the group; an online member's client auto-approves the Add (the server only proves the requester has the permission)
- Keys live in the OS keystore: iOS Keychain / Android Keystore via `expo-secure-store`, macOS Keychain / Windows Credential Manager via Tauri, non-extractable WebCrypto keys in IndexedDB on web
- Device verification: safety numbers or QR scan; new devices are approved from an existing device
- Key backup: recovery passphrase (Argon2id) encrypts the user's identity keys and channel history keys; the encrypted blob is stored on the server
- History for new members and new devices: existing members' clients share encrypted history-key bundles, so joining a channel can show its past messages

**What moves to the client**

- Search, link previews, notification text and mention detection all run on-device
- Moderation: reports carry the decrypted message from the reporter's device, signed so it cannot be forged
- Data at rest on the server is ciphertext by design; Postgres and S3 encryption at rest is still on as defense in depth

**Hardening checklist**

- [ ] TLS 1.3 via Caddy, HSTS, WebSocket over TLS only
- [ ] Rate limits on auth, message send and upload endpoints
- [ ] Upload size caps; EXIF stripping on the client before encryption
- [ ] CSP on web and in the Tauri webview; no remote code in the desktop shell
- [ ] Session revocation and a device list per user
- [ ] Third-party crypto review before 1.0

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

The reference look (near-black canvas, faint dot grid, soft rounded cards, hairline borders, mono metadata) carries over, with a warm ember accent and a moss secondary so Aulora does not read as Slack purple or Discord blurple.

**Palettes**

| Token | Dark (Loam) | Light (Linen) | Use |
| --- | --- | --- | --- |
| `bg` | #0A0A0C | #F4F2EE | App canvas behind the dot grid |
| `grid-dot` | #1A1A1F | #E2DED6 | 1px dots on a 16px grid |
| `surface-1` | #111114 | #FBFAF7 | Sidebar, server rail |
| `surface-2` | #17171B | #FFFFFF | Cards, message hover, composer |
| `surface-3` | #1F1F24 | #EEEBE5 | Inputs, code blocks, pills |
| `border` | #26262C | #DDD8CF | Hairlines, card outlines |
| `text` | #ECEBEF | #18171B | Primary text |
| `text-muted` | #8B8A94 | #6B6873 | Timestamps, meta, placeholders |
| `accent` (Ember) | #F5A45B | #A8530F | Unread dot, mentions, primary buttons, focus ring |
| `accent-soft` | #F5A45B1F | #A8530F14 | Mention highlight background |
| `secondary` (Moss) | #8FD19E | #2F7A45 | Online presence, success, E2EE lock icon |
| `danger` | #F2777A | #C23A3E | Delete, errors, DND |

**Shape and type**

- Radii: 20px cards, 14px bubbles and inputs, 999px pills; hairline 1px borders, no heavy shadows
- UI font: Geist or Inter; metadata, file names, code and the channel header in Geist Mono or JetBrains Mono (echoing the reference's `projects/main` header)
- Chat layout is flat rows, not bubbles, on desktop and web; mobile uses softly rounded grouped rows
- "Thinking" style particle spinner reused as the reconnecting and loading indicator

**Blobatars**

- [Blobatar](https://blobatar.dev) generates a deterministic geometric avatar from any string, is MIT licensed, has no dependencies and ships a React component (`@blobatar/react`)
- Seed = stable user ID, not the display name, so avatars survive renames
- Web and desktop: `<Blobatar name={user.id} animate="hover" />`; mobile: render the core package's SVG output through `react-native-svg` (verify the core API exposes a raw SVG string)
- Uploaded profile photos are optional; blobatar is the default and the fallback
- Server icons in the rail and empty states use blobatars too; the role color draws a 2px ring around the avatar
- The Aulora logo: a soft arched doorway, the entrance to the hall, drawn as a single blobatar-style shape in Ember with a small speech-dot inside

## Data model sketch

These Convex tables cover v1; since one server is one workspace, no table needs a `workspaceId`. Better Auth manages its own user, session and account tables through its component. Every `*Ciphertext` field is opaque to the server.

| Table | Key fields | Indexes |
| --- | --- | --- |
| `server` | singleton: name, iconSeed, ownerId, settings, license key | none |
| `members` | userId, nickname, roleIds\[\], joinedAt, timeoutUntil | by\_user |
| `roles` | name, color, position, permissions (bigint bitfield), hoisted, mentionable | by\_position |
| `categories` | name, position, overrides\[\] | by\_position |
| `channels` | categoryId, kind (text, announcement, dm, group\_dm), nameCiphertext, topicCiphertext, mlsGroupId, overrides\[\], archived | by\_category, by\_dm\_key |
| `messages` | channelId, authorDeviceId, ciphertext, epoch, threadRootId, attachmentIds\[\], mentionUserIds\[\], editedAt, deletedAt | by\_channel\_created, by\_thread |
| `reactions` | messageId, userId, emojiCiphertext | by\_message |
| `readStates` | userId, channelId, lastReadMessageId, mentionCount | by\_user\_channel |
| `files` | storageId, uploaderId, sizeBytes, encrypted metadata (name, mime, dimensions, blurhash) | by\_uploader |
| `devices` | userId, platform, pushToken, identityKey, lastSeen | by\_user |
| `keyPackages` | deviceId, keyPackage, usedAt | by\_device\_unused |
| `mlsCommits` | channelId, epoch, commitCiphertext, welcomeCiphertext | by\_channel\_epoch |
| `keyBackups` | userId, backupCiphertext, kdfParams | by\_user |
| `presence` | userId, status, customStatusCiphertext, lastHeartbeat | by\_user |
| `typing` | channelId, userId, expiresAt | by\_channel |
| `notificationPrefs` | userId, scope (server or channel), level, muteUntil, keywordsCiphertext | by\_user\_scope |
| `invites` | code, createdBy, maxUses, uses, expiresAt | by\_code |
| `auditLog` | actorId, action, targetId, meta, at | by\_at |

- `mentionUserIds[]` is plaintext metadata by design so the server can count mentions and route push; the mention text itself stays encrypted

## Milestones

Seven phases take Aulora from a compose file to beta; because every message is encrypted, MLS goes in with core chat rather than being bolted on later.

| Phase | Scope | Done when |
| --- | --- | --- |
| 0. Spikes | Convex self-hosted + Better Auth generic OIDC, `ts-mls` two-device demo, Blobatar in React Native | All three risks proven or replaced |
| 1. Foundation | Monorepo, tokens, compose stack, server-connect screen, local + OIDC login | Sign in on web from a fresh `docker compose up` |
| 2. Core chat | MLS groups per channel, encrypted messages, threads, reactions, encrypted uploads, read state, local search | A team uses web daily and the database holds only ciphertext |
| 3. Roles | Role editor, bitfield checks in every mutation, channel overrides, audit log, invites | Permission test suite passes |
| 4. Clients | Tauri desktop (macOS polish first), Expo iOS/Android, deep links, desktop + web push | Same account works on all five clients |
| 5. Keys + mobile push | Device verification, key backup, history sharing for new members, project push relay for APNs/FCM | New phone restores history from backup and gets push |
| 6. Beta | Admin panel, backups, license key check, docs site, one-command installer | Outside tester self-hosts without help |
|  |  |  |

## Open questions

**Decided**

- Name: Aulora
- Mobile push: the project runs its own relay for official store builds
- Encryption: E2EE on every channel, DM and file
- Tenancy: one workspace per server; clients join many servers
- Database: Postgres
- License: free for personal and noncommercial use, paid for commercial use (see Licensing)

**Still open**

- [ ] Trademark and domain check for Aulora
- [ ] Pricing model for commercial licenses: per server, per seat, or flat annual
- [ ] Should the push relay be free for noncommercial servers and metered for licensed ones?
- [ ] Max members per channel to test MLS against (1,000? 10,000?)

## Licensing

Aulora uses a dual license: the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) for everyone, and a paid commercial license for businesses.

- PolyForm Noncommercial allows personal use (hobby, study, private entertainment) and use by charities, schools, public research, public safety and government bodies
- Any company or for-profit team running Aulora for work needs the commercial license
- It is source-available, not OSI open source; say so plainly in the README
- Contributors sign a CLA so the project can keep selling commercial licenses
- Enforcement is by license terms, not DRM; the admin panel just shows license status and a nag for unlicensed commercial installs
- Check third-party licenses (Convex backend, Better Auth, `ts-mls`, Blobatar is MIT) for compatibility before release

## Sources

- [Convex self-hosting README](https://github.com/get-convex/convex-backend/tree/main/self-hosted)
- [Convex: hosting on your own infrastructure](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/hosting_on_own_infra.md)
- [Blobatar](https://blobatar.dev)
- [Better Auth issue #5314 (OIDC/SSO plugins in Convex)](https://github.com/better-auth/better-auth/issues/5314)

* [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
