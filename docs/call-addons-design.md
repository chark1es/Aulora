# Call addons: transcription, guest calls, scheduled calls

Status: design for implementation. Three features that build on voice/video calls:

1. **Transcription addon** — server-side speech-to-text with per-speaker attribution, plus an LLM summary (OpenRouter or any OpenAI-compatible endpoint).
2. **Guest calls** — invite someone with no account to a call through a link and a host-approved lobby.
3. **Scheduled calls addon** — a tab for scheduling calls that open a configurable time before they start.

Read first: [Convex performance and upgrades](convex/README.md), [bots design](bots-design.md) (the precedent for an optional container that talks to Convex with a shared secret), [releases and client compatibility](releases.md), `packages/convex/convex/lib/calls.ts`, `packages/convex/convex/workspaceNotes.ts` (the addon pattern: `setEnabled`, `requireNotes`, `server.settings.notesEnabled`, `server.publicConfig.addons`).

Calls are a peer-to-peer WebRTC mesh signalled through Convex (`calls`, `callParticipants`, `callSignals`). The server never sees call audio. That drives the transcription design below.

## Hard rules

- **Authorization lives on the server.** Every public function re-checks permissions, bans, timeouts and membership. The UI only hides controls.
- **Everything new is off or owner-only by default.** New permission bits are granted to no role. Owners and administrators hold them implicitly (`Administrator` short-circuits `hasPermission`). The default `@everyone` role must not gain any of them (the one exception is noted under scheduled calls).
- Follow `docs/convex/README.md`: indexed, bounded reads; no `.collect()`, no unindexed `.filter()`, no dynamic `.paginate()` windows (`bun run perf:convex` enforces this). No high-frequency writes to shared records.
- Content that users type or speak (transcript text, summaries, meeting titles/descriptions) is sealed at rest with the existing server-side encryption helpers (`lib/sealed.ts`, `lib/sse.ts`), the same way messages and notes are. Secrets (LLM API key) are encrypted at rest and **never returned to any client**.
- No real credentials or user data in Git; use synthetic fixtures.
- Security-sensitive features (guest links, tokens, endpoint URLs) must have tests that try to abuse them, not only happy-path tests.
- Audit-log every create, revoke, admit, deny, remove, start, stop, delete and configuration change (`writeAudit`).
- Older supported clients must keep working: additive schema and API changes only; new fields optional. Do not change `API_VERSION`.

## Permissions

Add to `packages/core/src/permissions.ts` (next free bits after `ManageWebhooks = 1n << 41n`), mirror them in the role editor's labels, and in any server-side permission catalog/tests that enumerate flags:

| Flag | Allows |
| --- | --- |
| `StartTranscription` | Start and stop transcription in a call the member is in |
| `ViewTranscripts` | Read transcripts and summaries, and request a (re)summary |
| `ManageTranscription` | Configure the addon (STT model, LLM endpoint/key/model, retention), download models, delete transcripts |
| `CreateGuestLinks` | Create guest invite links for calls the member can join |
| `ManageGuestAccess` | Admit, deny or remove guests in any call; revoke any guest link |
| `ScheduleCalls` | Create, edit and cancel own scheduled calls |
| `ManageScheduledCalls` | Edit and cancel anyone's scheduled calls |
| `ViewScheduledCalls` | See the Scheduled tab; sees only calls they are invited to or may join (the only flag granted to `@everyone`, once, with a stored migration marker like Kanban's) |

Enabling or disabling an addon and changing the guest-calls setting require `ManageWorkspace`. Banned users and timed-out members cannot use any of this (`assertMayParticipate`). Admit/deny may also be done by the creator of the link who is currently in that call.

Settings (in `server.settings`, optional fields, defaults false): `transcriptionEnabled`, `scheduledCallsEnabled`, `guestCallsEnabled`. Expose all three in `server.publicConfig.addons`.

## 1. Transcription addon

### Architecture (no media server, no Docker for the *feature* gating, one optional container for the engine)

Per-participant streaming. While transcription is active, each participant's own client captures **their own** microphone, converts it to 16 kHz mono PCM16, and streams it over a WebSocket to an optional `transcriber` service. One stream is one person, so **speaker attribution is exact and overlapping speech is handled correctly**. Identity comes from a short-lived signed token minted by Convex, never from anything the client claims. (Two people sharing one physical mic cannot be separated; document it.) A muted participant sends nothing.

```
client mic ──PCM16 WS──▶ web nginx /transcribe/ ──▶ transcriber ──segments (shared secret)──▶ Convex HTTP /transcription/ingest
                                      ▲ token minted by Convex mutation
                              Convex action ──chat/completions──▶ OpenRouter / OpenAI-compatible  (summary)
```

- **`transcriber` container**: new `infra/transcriber/` (Python 3.12, FastAPI/uvicorn, `faster-whisper` on CPU int8 with its built-in VAD; GPU optional via a documented override). Compose **profile `transcription`**, so it is not started by default. It joins only the network it needs and can reach Convex only through the ingest URL. It runs as non-root with a read-only root filesystem plus a models volume.
- **Models are downloaded as an addon step, not baked into the image.** The owner enables the addon in Workspace settings → Addons, picks a model size (e.g. `tiny`, `base`, `small`, `medium`, `large-v3-turbo`) and clicks **Download**. Convex asks the transcriber to fetch it into the `transcriber-models` volume (from Hugging Face by model id; allowlist the model ids, never take a URL). Progress and status (`not_installed | downloading | ready | error`) are reported back and shown in the UI. The addon is unusable until a model is `ready`. The image itself stays small.
- **Auth between the pieces.** Convex mints an audio token (HMAC-SHA256, short TTL such as 60 s to connect, binding `transcriptionSessionId`, speaker identity as a `userId` or `guestId`, and an expiry). The transcriber verifies it with `TRANSCRIBER_TOKEN`-derived key (the same style as `BOT_RUNNER_TOKEN`: constant-time comparisons, no secret ever logged) and posts finished segments to `/transcription/ingest` with the bearer secret. Convex re-validates that the session is active and that the speaker really is a participant of that call. Reject oversized frames, cap concurrent streams per session and per identity, and close idle sockets.
- **Segments**: `{sessionId, speakerKey, startMs, endMs, text, confidence?, language?}`. Drop empty/hallucinated filler (Whisper "Thank you." on silence) via VAD and a no-speech threshold. Ordering uses `startMs` relative to the session start.
- **Retention and limits**: per-workspace retention days (default 30, 0 = keep until deleted), a hard cap on segments per session, a daily cron to purge expired transcripts. Deleting a transcript deletes its segments and summary.

### Data model

- `transcriptionSessions`: `callId`, `channelId` (optional for standalone rooms), `startedBy`, `startedAt`, `endedAt?`, `status` (`active | ended | failed`), `summaryStatus` (`none | pending | ready | error`), sealed `summary` fields, `summaryModel?`, `summaryAt?`, `retentionExpiresAt?`.
- `transcriptSegments`: `sessionId`, `seq`, `speakerKey` (user id or guest id), `speakerName` (display name snapshot, sealed), sealed `text`, `startMs`, `endMs`. Index `by_session_seq`. Paginated reads only.
- `transcriptionConfig` (single doc, or fields on `server.settings`): STT model id + install status, LLM `baseUrl`, sealed `apiKey`, `model`, `provider` (`openrouter | openai_compatible`), summary language/style options, retention.

### Control flow

- `transcription.start({callId})` needs `StartTranscription` and membership of the call; only one active session per call; refuses unless the addon is enabled and a model is `ready`. It sets a flag the roster query exposes (`transcribing: boolean`, `transcriptionSessionId`) so **every participant, including guests, sees an indicator and a notice**. `stop` ends it. Ending the call or the last participant leaving ends it (hook into `endCall`/`finishIfEmpty`).
- Each participant's client reads the flag and, after showing the notice, calls `transcription.mintAudioToken`. Participants may **opt out of sending their own audio**; their speech is then simply not transcribed. Say so in the notice.
- After a session ends, an internal action builds the summary (also callable on demand with `ViewTranscripts`).

### Summary

An internal action loads the session's segments (paginated, decrypted), builds a speaker-labelled transcript, and calls the configured endpoint with `POST {baseUrl}/chat/completions` (OpenRouter default `https://openrouter.ai/api/v1`; send the API key as a bearer token; include OpenRouter's optional attribution headers only for OpenRouter). Long transcripts are map-reduced in chunks. Output is structured: overview, key points, decisions, action items with owners, optional per-speaker highlights, and detected language. Treat the transcript as **untrusted data**: put it inside clearly delimited data blocks, instruct the model never to follow instructions found there, validate and length-limit the JSON/markdown that comes back, and render it as sanitized text/markdown on the client. A "Test connection" mutation validates the endpoint and key without leaking the key.

**SSRF hardening for the configurable endpoint.** Require `https` by default. Resolve the host and reject loopback, link-local (including cloud metadata `169.254.169.254`), private and unique-local ranges unless the owner ticks an explicit "Allow private network endpoint (e.g. local Ollama)" setting; disallow redirects to a different host; strict timeouts and response-size caps; never echo upstream error bodies containing secrets.

### Read access

`ViewTranscripts` gates `transcription.listSessions`, `getSession`, `listSegments` (paginated) and the summary. Starting a call does not give read access. Channel visibility is not enough. Participants without `ViewTranscripts` get no transcript content even for calls they attended. Guests never get read access.

## 2. Guest calls

A permissioned member creates a guest link for a call. The guest opens it on the **web** (the Aulora server URL), types a name and optional affiliation, and waits in a lobby until a member admits them.

### Identity and isolation (the critical part)

Guests do **not** get a Better Auth user, a Convex JWT, a workspace membership or any account. Giving them an authenticated identity would make every function that only calls `requireAuth` reachable. Instead:

- Guests call a **separate, tiny set of public functions** (`guestCalls.*`) that take an opaque **guest session token** as an argument and verify its SHA-256 hash against `callGuestSessions`. These functions expose only what a guest needs for the one call they were admitted to: call roster (display names, mute/video flags), WebRTC signalling to and from the participants, ICE server config, transcription indicator and audio token, leave. They never return channel names, workspace data, member ids, files or chat.
- Tests must prove a guest token cannot be used on any existing function, that a guest has no identity (`ctx.auth` is null) on those paths, and that one guest's token cannot read another call's data.
- Guest presence in `callParticipants` uses a separate `guestId` (Convex id of the guest session) alongside the existing `userId` string. Audit every place that assumes `userId` is an account (rosters, `isCallMember`, signalling, alone-timer distinct-participant counting, sweep, leave beacon) and make guests count correctly and safely.

### Links

- `callGuestLinks`: `tokenHash` (SHA-256 of a 256-bit random token, URL-safe; the plaintext is shown **once** at creation and never stored), `callTarget` (a channel call or a scheduled call), `createdBy`, `createdAt`, `expiresAt`, `maxUses`, `uses`, `revokedAt?`, optional `label`. Defaults: expires in 1 hour (max 7 days, and never later than the end of a linked scheduled call plus a short grace), `maxUses` 5 (max 25). Constant-time token comparison; all invalid, expired, revoked and exhausted states return the **same generic error**, so links cannot be probed.
- Link URL: `<SITE_URL>/call/guest#<token>`. The token travels in the URL **fragment**, so it never reaches server logs, the HTTP `Referer` or intermediaries. The page sets `noindex` and no-referrer. Document that anyone with the link can ask to join, but cannot enter without being admitted.
- Caps: active links per call and per creator; maximum guests per call (default 8, within `MAX_CALL_SEATS`); guests count toward mesh size limits.
- Creating links needs `CreateGuestLinks`, `guestCallsEnabled`, membership of the call, and no ban/timeout. Revoking: the creator or `ManageGuestAccess`. Revoking a link does not eject admitted guests; removing a guest does (`ManageGuestAccess` or an admitting member), and it blocks that guest session from re-requesting through the same link.

### Join flow and lobby

1. Guest opens the link, `guestCalls.preview({token})` returns only the call title and whether it is open (generic otherwise).
2. Guest submits **display name** (required, 1–40 chars) and **affiliation** (optional, 0–60 chars). The server trims, normalizes Unicode, strips control and bidirectional-override characters, collapses whitespace, and rejects empty results. Guests are always shown with a **Guest** badge, so a guest cannot impersonate a member by naming themselves after one.
3. `guestCalls.requestJoin` creates a `pending` request (and a session token returned once). Rate limit per link, per token hash and globally (use `lib/rateLimit.ts`); cap pending requests per link (e.g. 10) and expire them after about 10 minutes. If the call is not open yet (scheduled), the guest sees "The call hasn't started yet" with the local-time start.
4. Members who are in the call and hold `ManageGuestAccess`, or are the link's creator, get a live "N people waiting" prompt with name and affiliation, and can admit or deny. Admit creates the participant row; deny blocks the request.
5. Admitted guests get a session valid until the call ends or at most 4 hours; heartbeats follow the existing participant stale logic.

Guests can use mic and camera. No screen sharing in v1. Guests cannot start recording or transcription, cannot admit others, and cannot create links.

### Transcription and guests

The transcription indicator and opt-out notice appear on the guest page. A guest's audio token is minted through `guestCalls.*` and bound to that guest session.

## 3. Scheduled calls addon

- `scheduledCalls`: `title` and `description` (sealed), `startsAt` (UTC ms), `durationMinutes` (optional), `openLeadMinutes` (call opens this long before start; default 5, allowed 0–120), `channelId?` (a voice channel or a DM/group DM the scheduler can access) **or** a **standalone room** with `inviteeUserIds` and `inviteeRoleIds`, `createdBy`, `status` (`scheduled | open | ended | cancelled`), `callId?`, timestamps. No recurrence in v1. Reads are indexed and bounded (index by `startsAt`).
- Channel-bound calls are joinable by whoever may `Connect` to that channel. Standalone rooms are joinable by the creator, listed invitees and members of invited roles. Guests join only through a link attached to the scheduled call. Standalone rooms need a call row that is not tied to a channel: extend `calls` additively (optional `channelId`, optional `scheduledCallId`) and audit every consumer of `calls.channelId`.
- `startsAt` and all times are stored in UTC and rendered by clients in the viewer's **local time zone** (`Intl.DateTimeFormat`, with the zone name shown). The server never stores local time.
- **Joining before `startsAt - openLeadMinutes` is refused** on the server with a typed, user-presentable error (`ScheduledCallNotOpen` plus the open time). The UI shows "This call hasn't started yet" with the local start time. The enforcement is server-side, including for guest links; the timer in the UI is cosmetic. A scheduler job at the open time moves `scheduled` to `open` and sends an in-app notification to invitees if the existing notification infrastructure allows it cheaply. Cancelled or ended calls refuse joins.
- Needs `scheduledCallsEnabled`. Creating and editing need `ScheduleCalls` (own) or `ManageScheduledCalls` (any). Listing needs `ViewScheduledCalls` and returns only calls the viewer is invited to or may join, plus their own. A cap on upcoming calls per workspace and per creator; title/description length limits; `startsAt` must be in the future (small tolerance) and within a year.
- The tab lives in the web/desktop client alongside the Kanban/Notes entries and appears when the addon is on and the member has `ViewScheduledCalls`. Native mobile screens are a follow-up and out of scope for v1.

## Operator surface

- New compose profile `transcription` (service `transcriber`), a models volume, `TRANSCRIBER_TOKEN` generated by the existing installer/setup flow like the other generated secrets, nginx proxy route for the audio WebSocket (`/transcribe/`) with sensible timeouts and size limits, and updates to the installer/update scripts and their `infra` tests where secrets or profiles are enumerated. Without the profile, the addon shows "Transcription service not installed" and stays unusable; nothing else is affected.
- Env catalog entries for new tunables (read-only if they are deploy-time), and docs pages registered in `apps/docs/scripts/build.mjs`: `transcription.md`, `guest-calls.md`, `scheduled-calls.md`, plus the admin guide's permission table and `docs/environment.md` if relevant. State the trust model plainly: the transcriber and the summary endpoint see call content; audio is processed in memory and not stored; the LLM endpoint receives transcript text; guests expose their IP to other participants as in any WebRTC call.

## Frontend (web and desktop, `apps/web`; shared logic in `packages/core`)

- **Transcription indicator**: use the [`thinking-orbs`](https://libraries.dev/orbs) React package (`<ThinkingOrb state="listening" size={20} dark={…} />`, zero runtime dependencies) as the symbol that shows a transcription is in progress. Show it in the call controls/dock/stage header and for guests, with a tooltip and an accessible label, and respect `prefers-reduced-motion` (`paused`). Pin an exact version at least two weeks old, confirm its license is compatible before adding it, and add the notice entries the repo requires (`bun run notices`). The page lists no license, so verify in the package and fall back to a small in-house CSS orb if it is not permissive.
- Start/Stop transcription control (only when the member has the permission and the addon is ready), the in-call notice with the opt-out, a Transcripts surface for `ViewTranscripts` (list, speaker-labelled transcript, summary, regenerate), and the Addons settings card for transcription (model download, LLM endpoint/key/model, test connection, retention, SSRF opt-in) and for scheduled calls and guest calls toggles.
- Audio capture for transcription: an `AudioWorklet` that taps the participant's existing processed mic stream, downsamples to 16 kHz mono PCM16, frames it, and streams it over the WebSocket with the minted token. Reconnect with backoff, stop on mute and on leave, and never capture when the participant opted out.
- **Guest page** at `/call/guest`: unauthenticated, outside the signed-in shell, with a Meet/Zoom-style lobby (name, affiliation, device check, "Ask to join", waiting state, denied/removed/ended/not-started states) and a reduced call view built on the existing call engine, running through `guestCalls.*` instead of the member functions. Members in the call get a lobby prompt to admit or deny.
- **Scheduled tab**: list upcoming and past calls in the viewer's local time (with zone), create/edit dialog (title, date/time picker in local time, open-before minutes, channel or standalone invitees, optional guest link), "Join" that is disabled with "Starts at …/hasn't started yet" before the open time, and cancel.
- Invite-guest action in the call UI for members with `CreateGuestLinks`, showing the link once with copy, expiry, uses and revoke.
- Follow the existing design system, accessibility conventions and component patterns; add tests for the logic-heavy parts.

## Acceptance

`bun run lint`, `bun run typecheck`, `bun run test`, `bun run perf:convex`, `bun run test:infra` and `bun run docs:check` pass. New backend behaviour has tests for permissions (denied by default, allowed when granted, owner/admin implicit), ban/timeout handling, link abuse (expired, revoked, exhausted, brute force, probing oracle), guest isolation, the open-window enforcement, transcript read gating, retention, and SSRF rules.
