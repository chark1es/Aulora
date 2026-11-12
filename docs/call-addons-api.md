# Call addons API handoff

Backend contract for the transcription, guest-call and scheduled-call addons.
The frontend agent can code against this file and the generated Convex types.
Everything here is additive; `API_VERSION` is unchanged.

Companion docs: [design](call-addons-design.md), [transcription](../apps/docs/content/transcription.md),
[guest calls](../apps/docs/content/guest-calls.md), [scheduled calls](../apps/docs/content/scheduled-calls.md).

## Permission flags

Bits 42–49 in `packages/core/src/permissions.ts`:

| Flag | Bit | Default grants |
| --- | --- | --- |
| `StartTranscription` | 42 | none |
| `ViewTranscripts` | 43 | none |
| `ManageTranscription` | 44 | none |
| `CreateGuestLinks` | 45 | none |
| `ManageGuestAccess` | 46 | none |
| `ScheduleCalls` | 47 | none |
| `ManageScheduledCalls` | 48 | none |
| `ViewScheduledCalls` | 49 | `@everyone` once, via the `grant-scheduled-calls-view` migration marker |

Owners and administrators hold every flag implicitly (`Administrator`
short-circuits `hasPermission`). The role editor must add labels/groups for
these eight flags; the shared names are the keys above.

## Workspace flags

`server.publicConfig.addons` is now:

```ts
{
  kanban: boolean;
  notes: boolean;
  transcription: boolean;
  guestCalls: boolean;
  scheduledCalls: boolean;
}
```

All five default to `false`. Toggle them with `addons.setEnabled`.

### `addons.status` (query)

No arguments. Any signed-in member; an unauthenticated caller gets
`"Not authenticated"`.

```ts
{
  transcription: boolean;
  guestCalls: boolean;
  scheduledCalls: boolean;
  transcriptionModel: {
    id: string | null;
    status: "not_installed" | "downloading" | "ready" | "error";
    progress: number | null;
    // The running container's engine state, not the owner's selection.
    runtimeReady: boolean;
  };
}
```

### `addons.setEnabled` (mutation)

Requires `ManageWorkspace` and an un-banned/un-timed-out caller.

```ts
setEnabled({ addon: "transcription" | "guestCalls" | "scheduledCalls"; enabled: boolean }): null
```

Throws `"Workspace is not initialized"` when there is no server row.

---

## Transcription

### `transcription.status` (query)

Any signed-in member. Does not require a permission; used to hide controls.

```ts
{
  enabled: boolean;
  modelId: string | null;
  modelStatus: "not_installed" | "downloading" | "ready" | "error";
  modelProgress: number | null;
  ready: boolean;                  // the owner's selected model is ready
  // True only while a recent hello reports a loaded engine. Start requires it;
  // a restarted/empty container leaves it false even if `modelStatus` is ready.
  runtimeReady: boolean;
  retentionDays: number;
  // True only while the container has reported a hello within ~3 minutes and
  // the shared secret exists. Setup always generates the secret, so the secret
  // alone is not proof the optional profile is running.
  serviceInstalled: boolean;
}
```

### `transcription.getConfig` (query)

Requires `ManageTranscription`.

```ts
{
  modelId: string;                 // default "base"
  modelStatus: "not_installed" | "downloading" | "ready" | "error";
  modelProgress: number | null;
  modelError: string | null;
  provider: "openrouter" | "openai_compatible";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;              // never the key itself
  summaryLanguage: string | null;
  summaryStyle: string | null;
  retentionDays: number;
  allowPrivateEndpoint: boolean;
  updatedAt: number;
  availableModels: readonly string[]; // ["tiny","base","small","medium","large-v3-turbo"]
  serviceInstalled: boolean;
}
```

Throws `"Missing permission"` (workspace permission gate).

### `transcription.updateConfig` (mutation)

Requires `ManageTranscription`; banned/timed-out callers rejected.

```ts
updateConfig({
  provider?: "openrouter" | "openai_compatible";
  baseUrl?: string;
  apiKey?: string;        // omit = keep; "" = clear; non-empty = replace (sealed)
  model?: string;
  summaryLanguage?: string;
  summaryStyle?: string;
  retentionDays?: number;
  allowPrivateEndpoint?: boolean;
}): null
```

Errors: `"The summary endpoint must be a valid URL"`, `"The summary model name
is too long"`, `"Summary options are too long"`. The API key is sealed with the
workspace key and never returned by any query or action.

### `transcription.downloadModel` (mutation)

Requires `ManageTranscription`. `modelId` must be one of the allowlisted ids.

```ts
downloadModel({ modelId: string }): null
```

Sets the config to `downloading` and schedules an internal action that posts
`{modelId}` to the transcriber's `/admin/model`. The transcriber reports progress
and status back to `POST /transcription/model`. Errors: `"That model is not
available"`, `"Transcription service not installed"` (no `TRANSCRIBER_TOKEN`).

### `transcription.start` (mutation)

Requires `StartTranscription`, the addon enabled, a `ready` model, a live call
and a seat in it.

```ts
start({ callId: Id<"calls"> }): { sessionId: Id<"transcriptionSessions"> }
```

Errors: `"Transcription is disabled"`, `"Download a speech model before starting
transcription"`, `"The transcription service is not running; start the
transcriber container"` (no recent heartbeat), `"Transcription is already
running in this call"`, `"You are not in this call"`, `"This call has ended"`.

Setting the active session also makes `transcribing: true` and
`transcriptionSessionId` appear on every `calls.get`/`forChannel`/`incoming`
summary, including the guest roster.

### `transcription.stop` (mutation)

The starter, a seated member with `StartTranscription`, or anyone with
`ManageTranscription`.

```ts
stop({ sessionId: Id<"transcriptionSessions"> }): null
```

Idempotent for a session that is already `ending` or `ended`. Throws
`"Transcription session not found"` or `"Missing transcript permission"`.

`stop` moves an active session to `ending` with `endsAt = now + 30 s` and
schedules the finalizer. During that window `ingestSegments` still accepts the
transcriber's final buffered window from speakers authorized earlier in the
session, even after their seat is gone; segments that start after the stop time
(+5 s tolerance) are rejected. The summary is queued only when the window
closes, and the session becomes `ended`. Disabling the addon is immediate: no
grace applies and ingest is rejected while disabled. A late audio token cannot
be minted once the session is `ending`.

### `transcription.mintAudioTokenForCall` (mutation)

The caller must hold a member seat in the call.

```ts
mintAudioTokenForCall({ sessionId }): {
  token: string;      // opaque, short-lived (60 s), HMAC-SHA256
  expiresAt: number;  // epoch ms
  sessionId: Id<"transcriptionSessions">;
  wsPath: "/transcribe/"; // append to the site origin: wss://<site>/transcribe/ws
}
```

Errors: `"Transcription is not running"`, `"This call has ended"`, `"You are not
in this call"`, `"Transcription service not installed"`.

### `transcription.listSessions` (query)

Requires `ViewTranscripts`. `limit` defaults to 30, maximum 100. Newest first.

```ts
listSessions({ limit?: number }): Array<{
  id: Id<"transcriptionSessions">;
  callId: Id<"calls">;
  channelId: Id<"channels"> | null;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
  status: "active" | "ending" | "ended" | "failed";
  summaryStatus: "none" | "pending" | "ready" | "error";
  // True when an LLM endpoint key is configured. When false, `summaryStatus`
  // stays `none` and the UI should show a neutral "No summary service
  // configured" state, not an error.
  summaryConfigured: boolean;
  segmentCount: number;
  retentionExpiresAt: number | null;
}>
```

### `transcription.getSession` (query)

Requires `ViewTranscripts`.

```ts
getSession({ sessionId }): {
  id; callId; channelId: Id<"channels"> | null;
  startedBy; startedAt; endedAt: number | null;
  status; summaryStatus;
  summaryConfigured: boolean;  // see listSessions
  summary: string | null;      // JSON text of TranscriptSummary, or null
  summaryModel: string | null;
  summaryAt: number | null;
  summaryError: string | null;
  segmentCount: number;
  retentionExpiresAt: number | null;
}
```

`TranscriptSummary` (parse the JSON string):

```ts
{
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: { text: string; owner: string | null }[];
  speakerHighlights: { speaker: string; text: string }[];
  language: string | null;
}
```

### `transcription.listSegments` (query)

Requires `ViewTranscripts`. Rows are ordered by the **session-relative
`startMs`** with `_creationTime` as the stable tie-break, not by `seq`: two
speakers and a reconnect all start their own `seq` at 1, so `seq` is only a
per-speaker replay value.

Paging uses an opaque index cursor with a constant page size (100). The cursor
is stable across inserts and never re-reads an earlier page. This replaces the
unreleased `afterSeq`/`nextAfterSeq` offset shape.

```ts
listSegments({
  sessionId: Id<"transcriptionSessions">;
  cursor?: string;     // opaque `nextCursor`; omit for the first page
}): {
  page: Array<{
    id: Id<"transcriptSegments">;
    seq: number;              // per-speaker sequence (1-based)
    speakerKey: string;       // "user:<id>" or "guest:<id>"
    speakerName: string;      // sealed snapshot, opened
    text: string;
    startMs: number;          // ms from the transcription session start
    endMs: number;
    confidence: number | null;
    language: string | null;
  }>;
  nextCursor: string | null;  // null on the last page
}
```

### `transcription.requestSummary` (mutation)

Requires `ViewTranscripts`. Marks the session `pending` and schedules the
summary action.

```ts
requestSummary({ sessionId }): null
```

Errors: `"Configure a summary endpoint first"`, `"Transcription session not
found"`.

### `transcription.deleteSession` (mutation)

Requires `ManageTranscription`. Deletes the session row and queues bounded
deletion of its segments.

```ts
deleteSession({ sessionId }): null
```

Errors: `"Stop transcription before deleting it"`. Deleting an already-missing
session returns `null`.

### `transcriptionActions.testConnection` (action)

Requires `ManageTranscription`. Accepts form overrides so the owner can test
before saving. The key is never returned or echoed.

```ts
testConnection({
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  allowPrivateEndpoint?: boolean;
}): { ok: true; model: string }
```

Errors are sanitized `ConvexError` messages: `"Add an API key first"`, `"The
summary endpoint must use https (or enable the private-network option)"`, `"The
summary endpoint points at a private or loopback address"`, `"The summary
endpoint redirected to a different host"`, `"The summary endpoint timed out"`,
`"Could not reach the summary endpoint"`, HTTP-status messages. Upstream bodies
are never included.

---

## Guest calls

Guests have **no Convex identity**. These functions take a token argument and
must be callable without a session. Every failure to resolve a link or session
returns the same message:

```
This guest link is not available
```

Export that from `@aulora/core` as `GUEST_LINK_GENERIC_ERROR`.

### Guest-side functions (no identity)

#### `guestCalls.preview({ token })` (query)

```ts
{ title: string; open: boolean; startsAt: number | null; opensAt: number | null }
```

`title` is the sealed scheduled-call title, or the literal `"Guest call"` for a
channel link (channel names are not disclosed). `open` is true only when a live
call exists and a scheduled call's open time has passed. Invalid/expired/
revoked/exhausted links throw the generic error.

#### `guestCalls.requestJoin(...)` (mutation)

```ts
requestJoin({
  token: string;              // link token from the URL fragment
  displayName: string;        // 1–40 chars after normalization
  affiliation?: string;       // 0–60 chars
  clientId?: string;          // 8–80 [A-Za-z0-9_-]; used for heartbeat blocking
}): {
  sessionToken: string;       // returned once; store in memory/sessionStorage
  guestSessionId: Id<"callGuestSessions">;
  status: "pending";
  expiresAt: number;
  callId: Id<"calls">;
}
```

- Generic link error for an unusable link.
- Scheduled call before its window throws a structured `ConvexError` whose data
  is `{ code: "ScheduledCallNotOpen", message: "This call hasn't started yet",
  startsAt, opensAt }`.
- No live call yet: `"The call hasn't started yet"`.
- `"Too many people are waiting to join this call"` at the pending cap.
- `"Rate limit exceeded"` per link/address.
- `"Display name must be 1–40 characters"`, `"Affiliation must be at most 60
  characters"`.

The link's `uses` counter increments on **admit**, not on request.

#### `guestCalls.lobby({ sessionToken })` (query)

```ts
{
  guestSessionId; status: "pending" | "admitted" | "denied" | "removed" | "left" | "expired";
  displayName: string;
  affiliation: string | null;
  callId: Id<"calls"> | null;
  expiresAt: number;
}
```

The page polls/subscribes this while waiting. A token for a deleted session
throws the generic error. Once `expiresAt <= now`, a pending or admitted
session reports `"expired"` immediately; the page does not wait for the hourly
prune. A pending or admitted session whose call has ended (or no longer
resolves) reports `"left"` — the terminal status the guest page renders as
"The call has ended" — so a waiting guest is never left on "Waiting to be let
in" after the room is gone. Host `lobbyList` likewise omits expired
pending/admitted rows.

#### `guestCalls.roster({ sessionToken })` (query)

```ts
{
  guestSessionId;
  displayName: string;
  affiliation: string | null;
  callId: Id<"calls">;
  callStatus: "ringing" | "active" | "ended";
  scheduledCallId: Id<"scheduledCalls"> | null;
  transcribing: boolean;
  transcriptionSessionId: Id<"transcriptionSessions"> | null;
  participants: Array<{
    participantKey: string;   // opaque; use this for `signal.toParticipantKey`
    isGuest: boolean;
    displayName: string;      // the guest's chosen name (render a Guest badge), or a member's account name
    muted: boolean;
    video: boolean;
    joinedAt: number;
    session: number;          // seat generation; peers ignore signalling from an older one
    // Member rows only. True when the guest must create the offer toward this
    // member: the exact complement of shouldOffer(memberAccountId, guestSessionId).
    // Guest rows omit it.
    shouldOffer?: boolean;
  }>;
}
```

The roster **never** returns member account ids, channel names, workspace data,
files or chat. The key contract is exact:

- a **guest** row's `participantKey` is that guest's **session id**
  (`guestSessionId` from `lobby`/`requestJoin`), which is also the identity the
  guest call engine uses for itself;
- a **member** row's `participantKey` is the opaque per-call `guestKey`.

Render a **Guest** badge for `isGuest`. The guest's own roster entry therefore
matches its engine identity, so it can find itself in the roster.
`participantKey` is only a signalling address; **offer election does not use
it**.

Election now matches the account-id rule every member client evaluates,
including mobile and older clients. For a member row, the guest reads
`shouldOffer`: when it is `true` the guest creates the offer toward that
member, when `false` it waits. It is exactly
`!shouldOffer(memberAccountId, guestSessionId)` using `@aulora/core`'s
`shouldOffer` (the member evaluates `memberAccountId < guestSessionId`; the
member never receives the guest's choice bit). Guest rows omit the field:
guests elect among themselves with `shouldOffer(selfGuestSessionId,
otherGuestSessionId)`, which is complementary on both sides. Renegotiation uses
the same rule.

#### `guestCalls.signal(...)` (mutation)

```ts
signal({
  sessionToken: string;
  toParticipantKey: string;   // a roster `participantKey`
  kind: "offer" | "answer" | "ice" | "renegotiate";
  payload?: string;
  payloads?: string[];        // pooled ICE, max 32 total payloads
}): null
```

Errors: `"This call has ended"`, `"A signal needs a payload"`, `"Too many
signalling payloads"`, `"Signalling payload is too large"`, `"Signalling target
is not in this call"`, `"You are not in this call"`, `"Rate limit exceeded"`.

#### `guestCalls.signals({ sessionToken })` (query)

```ts
Array<{
  id: Id<"callSignals">;
  // Same scheme as the roster: a member sender is its opaque `guestKey`, a
  // guest sender is its guest session id. A signal whose sender seat is gone
  // is dropped rather than falling back to the member's account id.
  fromParticipantKey: string;
  kind: "offer" | "answer" | "ice" | "renegotiate";
  payload: string;
  session: number;
  createdAt: number;
}>
```

#### `guestCalls.ack({ sessionToken, signalIds })` (mutation)

Deletes only rows addressed to this guest. Returns `null`. `signalIds` is
capped at `GUEST_SIGNAL_ACK_MAX` (32, exported by `@aulora/core`); a larger
array throws `"Too many signalling acknowledgements"` before any row is read.
The client must chunk larger batches by that constant. Calls share the
per-guest-session signalling rate limit (`guest-ack:<sessionId>`), which throws
`"Rate limit exceeded"`. `guestCalls.signals` still returns up to 256 rows so a
single query never starves on rows whose sender seat disappeared; acknowledged
rows are deleted, so the next query shows the next batch.

#### `guestCalls.updateParticipant(...)` (mutation)

```ts
updateParticipant({ sessionToken; muted?: boolean; video?: boolean; sharingScreen?: boolean }): null
```

`sharingScreen: true` throws `"Guests cannot share their screen"`; v1 has no
guest screen sharing.

#### `guestCalls.turnCredentials({ sessionToken })` (mutation)

An admitted guest's short-lived TURN credential (`null` when the deployment has no
relay), bound to the guest session, never to an account. A guest still in the lobby
gets the generic link error. Public STUN/override servers come from the
unauthenticated `server.publicConfig` query.

```ts
{ urls: readonly string[]; username: string; credential: string; ttlSeconds: number; expiresAt: number } | null
```

#### `guestCalls.heartbeat({ sessionToken })` (mutation)

Refreshes the guest's participant and session rows. Returns
`{ expiresAt: number }`.

#### `guestCalls.leave({ sessionToken })` (mutation)

Removes the guest's participant row, clears their signalling and marks the
session left. The last participant out ends the call. Returns `null`.

#### `guestCalls.mintAudioToken({ sessionToken })` (mutation)

Only while a transcription session is active and the addon is enabled.

```ts
{
  token: string;
  expiresAt: number;
  sessionId: Id<"transcriptionSessions">;
  wsPath: "/transcribe/";
}
```

Errors: `"This call has ended"`, `"Transcription is disabled"`,
`"Transcription is not running in this call"`, `"Transcription service not
installed"`.

The token's speaker key is `guest:<guestSessionId>`, never a client claim.

### Member-side guest functions (identity required)

A **lobby manager** is a caller with `ManageGuestAccess`, or the creator of one
of the call's links who currently holds a member seat in that call.

#### `guestCalls.createLink(...)` (mutation)

Requires `CreateGuestLinks`, the addon enabled, no ban/timeout, and access to the
target. Exactly one of `channelId` / `scheduledCallId` must be given.

```ts
createLink({
  channelId?: Id<"channels">;
  scheduledCallId?: Id<"scheduledCalls">;
  label?: string;        // ≤ 60, operator-facing
  expiresInMs?: number;  // default 1 h; clamped to 1 min..7 days
  maxUses?: number;      // default 5; clamped to 1..25
}): {
  linkId: Id<"callGuestLinks">;
  token: string;         // plaintext, shown once
  url: string;           // <SITE_URL>/call/guest#<token>
  expiresAt: number;
  maxUses: number;
}
```

For a scheduled link the expiry is also capped at the call's end plus ten
minutes. Errors: `"Choose a channel call or a scheduled call"`, `"This call has
too many active guest links"`, `"You have too many active guest links for this
call"`, `"This scheduled call has ended"`, `"Missing permission"`.

#### `guestCalls.lobbyAccess({ callId })` (query)

Any signed-in member. Tells the UI whether it may subscribe to the lobby and
links, without raising a permission error for ordinary participants.

```ts
{ canManage: boolean }
```

#### `guestCalls.links({ callId } | { scheduledCallId })` (query)

Pass **exactly one** of `callId` (the in-call dialog) or `scheduledCallId`
(the Scheduled tab). A lobby manager for the live call may list every link; for
a scheduled call, its creator, `ManageGuestAccess` or `ManageScheduledCalls`
may. A caller who is not a manager — for example an invitee with
`CreateGuestLinks` before the room is live — still gets the links they created
themselves instead of an error. A channel-bound scheduled link stores both its
channel and its scheduled call, so it appears in either view. Returns links
without plaintext tokens, newest first:

```ts
links({
  callId?: Id<"calls">;
  scheduledCallId?: Id<"scheduledCalls">;
}): Array<{
  id; createdBy; createdAt; expiresAt; maxUses; uses;
  revoked: boolean;
  label: string | null;
}>
```

#### `guestCalls.revokeLink({ linkId })` (mutation)

The link creator (while they still hold `CreateGuestLinks`) or
`ManageGuestAccess`. Banned and timed-out members are refused. Idempotent;
returns `null`.

#### `guestCalls.lobbyList({ callId })` (query)

Lobby manager. Live lobby prompt data:

```ts
{
  pending: Array<{
    guestSessionId; displayName; affiliation: string | null;
    requestedAt; expiresAt;
  }>;
  admitted: Array<{
    guestSessionId; displayName; affiliation: string | null;
    admittedAt: number | null; expiresAt;
  }>;
}
```

#### `guestCalls.admit({ guestSessionId })` (mutation)

Lobby manager. Creates the guest participant row and returns
`{ callId, expiresAt }`. Errors: `"This request is no longer waiting"`, `"This
call already has the maximum number of guests"`, `"This call is full"`, generic
link error when the link is no longer usable.

If the scheduled link's live target is an unassociated channel room, admitting
claims it for that scheduled call (`scheduledCalls.callId` and
`calls.scheduledCallId`), so a second scheduled link cannot enter the same
room. Before the guest-facing roster is built, `admit` backfills a fresh opaque
`guestKey` on every member seat of the call that has none (bounded by
`MAX_CALL_SEATS`); a legacy row therefore never exposes the member's account id
through the roster or signals. The guest cap counts only admitted sessions with
`expiresAt > now`, so expired-but-unpruned rows never block a new guest.

#### `guestCalls.deny({ guestSessionId })` (mutation)

Lobby manager. Marks the request denied. Returns `null`.

#### `guestCalls.remove({ guestSessionId })` (mutation)

Lobby manager. Ejects the guest, marks the session removed and records the
guest's client hash on the link so the same browser cannot re-request through
it. Returns `null`.

---

## Scheduled calls

### `scheduledCalls.list(...)` (query)

Requires the addon and `ViewScheduledCalls`. Returns only what the viewer may
see: channel calls they can view, standalone rooms they created or were invited
to (by user or role), plus anything they manage.

```ts
list({
  from?: number;   // default now − 90 days
  to?: number;     // default now + 90 days
  limit?: number;  // default 50, maximum 100
}): Array<ScheduledCallView>
```

`ScheduledCallView`:

```ts
{
  id: Id<"scheduledCalls">;
  title: string;
  description: string;
  startsAt: number;              // UTC epoch ms
  durationMinutes: number | null;
  openLeadMinutes: number;
  opensAt: number;               // startsAt − openLeadMinutes*60000
  channelId: Id<"channels"> | null;
  inviteeUserIds: readonly string[];
  inviteeRoleIds: readonly string[];
  createdBy: string;
  status: "scheduled" | "open" | "ended" | "cancelled";
  callId: Id<"calls"> | null;
  canManage: boolean;
  canJoin: boolean;              // false only for cancelled/ended
}
```

Render `startsAt`/`opensAt` with `Intl.DateTimeFormat` in the viewer's zone and
show the zone name.

### `scheduledCalls.get({ scheduledCallId })` (query)

Same shape. Throws `"Scheduled call not found"` or `"You cannot see this
scheduled call"`.

### `scheduledCalls.create(...)` (mutation)

Requires `ScheduleCalls` or `ManageScheduledCalls`, the addon, and no
ban/timeout.

```ts
create({
  title: string;                 // 1–120
  description?: string;          // 0–2000
  startsAt: number;              // future (60 s tolerance), within one year
  durationMinutes?: number;      // 5–1440
  openLeadMinutes?: number;      // 0–120, default 5
  channelId?: Id<"channels">;    // channel-bound
  inviteeUserIds?: string[];     // standalone only
  inviteeRoleIds?: string[];     // standalone only
}): Id<"scheduledCalls">
```

A standalone room needs at least one invitee or role. Errors: `"Start time must
be in the future"`, `"Start time must be within the next year"`, `"Duration must
be 5–1440 minutes"`, `"Invite at least one person or role for a standalone
call"`, `"One of the invitees is not a member"`, `"One of the invited roles does
not exist"`, `"This workspace has reached its 200-call limit"`, `"You have
reached your 50-call limit"`, or `"Calls are only available in voice channels and
direct messages"` for a text/announcement channel.

### `scheduledCalls.update(...)` (mutation)

Creator **and** `ScheduleCalls`, or `ManageScheduledCalls` (ownership alone is
not a permission). Only while `status === "scheduled"`.

```ts
update({
  scheduledCallId: Id<"scheduledCalls">;
  title?: string;
  description?: string;
  startsAt?: number;
  durationMinutes?: number;
  openLeadMinutes?: number;
  inviteeUserIds?: string[];
  inviteeRoleIds?: string[];
}): null
```

Errors: `"You cannot edit this scheduled call"`, `"Only a call that has not
opened can be edited"`.

### `scheduledCalls.cancel({ scheduledCallId })` (mutation)

`ManageScheduledCalls`, or the creator while they still hold `ScheduleCalls`.
Ownership alone is not enough. Banned/timed-out callers are rejected. Cancels
the call and ends its live room. Idempotent for an already-cancelled/ended
call. Throws `"You cannot cancel this scheduled call"`.

### `scheduledCalls.join({ scheduledCallId, clientId })` (mutation)

Requires the addon, `Connect` (channel or workspace), invitee/role access for a
standalone room, and no ban/timeout.

```ts
join({ scheduledCallId; clientId: string }): {
  callId: Id<"calls">;
  created: boolean;               // true when this join created the room
  scheduledCallId: Id<"scheduledCalls">;
}
```

Before `opensAt` it throws a structured `ConvexError` whose data is:

```ts
{
  code: "ScheduledCallNotOpen";
  message: "This call hasn't started yet";
  startsAt: number;
  opensAt: number;
}
```

Catch it and render **This call hasn't started yet** with the local start time.
Other errors: `"This scheduled call has ended"`, `"You are not invited to this
call"`, `"Voice and video calls are disabled in this workspace"`, `"This call is
full"`, `"This call belongs to another scheduled meeting"`.

A channel-bound meeting reuses a live channel room only when it is
unassociated or already associated with that same meeting. A room already
claimed by another scheduled meeting is refused with `"This call belongs to
another scheduled meeting"`; it is never reused. Reusing an unassociated room
claims both sides (`calls.scheduledCallId` and `scheduledCalls.callId`) in the
same mutation, so a different meeting's guest admission cannot take it later.
The guest path calls the same helper.

---

## Existing `calls.*` additions the UI reads

These fields are additive; older clients ignore them.

`CallSummary` (from `calls.get`, `calls.forChannel`, `calls.incoming`,
`calls.activeCalls`):

```ts
{
  ...existing fields;
  channelId: Id<"channels"> | null;          // null for a standalone room
  transcribing: boolean;
  transcriptionSessionId: Id<"transcriptionSessions"> | null;
  scheduledCallId: Id<"scheduledCalls"> | null;
  standalone: boolean;
  guestCount: number;
}
```

`CallParticipantSummary`:

```ts
{
  ...existing fields;
  userId: string;                 // member id, or the guest session id for a guest
  guestId: Id<"callGuestSessions"> | null;
  isGuest: boolean;
  displayName: string | null;     // guest name; null for members
}
```

Offer election follows decision 46: every member client evaluates
`shouldOffer(self account id, remote userId)` (`@aulora/core`'s `shouldOffer`,
where `userId` is the guest session id for a guest row). A guest reads the
complementary `shouldOffer` bit on each member row of its roster, and guests
elect among themselves with their own guest session ids. There is no shared
opaque election key: the old `negotiationKey` field and `shouldOfferByKey`
helper were removed because nothing read them.

- A member addresses every participant (including a guest) with
  `calls.signal({ toUserId })`, using the summary's `userId`. A guest id works
  because the guest row's participant key is the guest session id.
- `calls.signals` now requires the caller to hold a seat in the call. This is a
  behaviour change from "any signed-in member can read a call's signals"; it is
  a security fix, not a response-shape change.
- Standalone scheduled rooms are not listed by `calls.activeCalls` (there is no
  channel sidebar row). Use the Scheduled tab and `calls.get`. `calls.get`
  authorizes a standalone room for its creator, a listed invitee, or a caller
  who already holds a seat there, so a seat keeps working after a role change
  removes `ViewScheduledCalls`. A caller who is none of those is still
  refused.
- `calls.join` still works for channel calls. A standalone room is joined
  through `scheduledCalls.join`.
- A call ending ends its transcription session and invalidates admitted guest
  sessions.

`@aulora/core` `CallView`/`CallParticipantView` have the same optional fields, so
the shared voice helpers continue to typecheck.

---

## HTTP routes

All are on the Convex site origin (`SITE_URL`), JSON, `cache-control: no-store`.

### `POST /transcription/ingest`

Header `Authorization: Bearer <TRANSCRIBER_TOKEN>` (constant-time SHA-256
comparison). Body:

```ts
{
  sessionId: string;
  speakerKey: string;          // "user:<id>" or "guest:<id>"
  segments: Array<{
    seq: number;               // per-speaker, strictly increasing, 1-based
    startMs: number;           // ms from the transcription session start
    endMs: number;
    text: string;              // ≤ 8000 chars; blank segments are dropped
    confidence?: number | null; // null is treated as absent
    language?: string | null;   // ≤ 20 chars; null is treated as absent
  }>;                          // 1..50 entries
}
```

`seq` is replayed per `(session, speaker)`, so every speaker has its own counter.
Transcript order is `startMs`, never `seq`. The stored per-speaker state is
always a high-water mark: `lastSeq`, `lastStartMs` and the stored count never go
backwards.

A batch whose `seq` is at or below the stored `lastSeq` is either a late
arrival, a replay, or a transcriber process restart:

- **Late arrival** (an evicted socket's teardown drain posted after a newer
  batch from its replacement): accepted only when none of its sequence numbers
  were stored for this speaker and its `[startMs, endMs]` range overlaps no
  stored segment for that speaker. This is what lets the drain land at all.
- **Restart** (the transcriber process restarted, so its counter began again at
  1): accepted only when the batch's first `startMs` is strictly after the
  stored high-water mark and its whole range overlaps nothing stored for that
  speaker. Uniqueness across a restart is therefore enforced by time ordering,
  not by `seq`; a stored `seq` from the previous generation does not reject a
  legitimate new one.
- **Replay**: a stored `seq` in the late-arrival path, or any range that
  overlaps stored audio, is rejected. Re-posting an old batch can never lower
  the state or duplicate text.

The transcriber also numbers and posts batches through one per-identity
delivery gate, so in normal operation a later sequence cannot overtake an
earlier one. A 4xx rejection is permanent (see the close codes below); 5xx,
timeouts and connection errors are retried with backoff. Logs never include the
secret or audio text.

Responses:

| Status | Body | Cause |
| --- | --- | --- |
| `200` | `{"ok":true,"accepted":n}` | Stored. |
| `400` | `{"error":"invalid_body"}` | Malformed body/limits. |
| `400` | `{"error":"rejected"}` | Session not active, speaker not in call, out-of-order seq, or segment cap. |
| `401` | `{"error":"unauthorized"}` | Wrong/missing bearer. |
| `503` | `{"error":"transcription_unavailable"}` | `TRANSCRIBER_TOKEN` unset. |

The mutation re-validates the session is active (or `ending`) and, while
active, that the speaker really holds a seat. Convex never trusts a
client-supplied identity. During the post-stop finalization window it accepts
only speakers with a `transcriptSpeakerState` row (authorized by start or by an
audio-token mint), no longer requires a current seat or a live call, and
rejects any segment whose `startMs` is after the stop time + 5 s. The addon flag
is still checked first, so a disabled addon rejects immediately.

### `POST /transcription/model`

Same bearer. Body:

```ts
{
  modelId: string;             // allowlisted
  status: "not_installed" | "downloading" | "ready" | "error";
  progress?: number | null;    // omitted or null = indeterminate; 100 when ready
  error?: string | null;       // ≤ 300 chars, no secrets; null is treated as absent
}
```

A download reports `downloading` without `progress` until it finishes (the UI
shows an indeterminate bar), then `ready` with `progress: 100`. A failed
download of a different model while A is loaded and ready reports A as `ready`
with a `lastError`/`error` message; it never downgrades A to `error`.

`200 {"ok":true}`; `400 {"error":"invalid_body"}`; `401`/`503` as above.

### `POST /transcription/hello`

Same bearer. Records that the container is alive and powers `serviceInstalled`.
The transcriber posts it at startup and roughly every 60 s; Convex writes only a
stale row, so a healthy service is not a hot document. Body:

```ts
{
  type?: "hello";                // accepted and ignored
  loadedModelId?: string | null; // the model actually loaded, not a download state
  loadedStatus?: "ready" | "not_installed" | null;
  loadedError?: string | null;   // ≤ 300 chars, no secrets
  downloadActive?: boolean;       // true only while a download is running
}
```

Every optional hello field may be `null` or absent. Presence is recorded before
and independently of model handling, so a cold start (`loadedModelId` absent)
still marks the service installed and a malformed model field is ignored rather
than returning `400`. Only a bad bearer or a structurally invalid body is
rejected. The Python heartbeat omits absent fields entirely and never sends
`null`.

Every hello also updates runtime readiness on the singleton status row:
`loadedStatus: "ready"` with a valid `loadedModelId` sets `runtimeReady` true
and `runtimeModelId` to that id; `"not_installed"` clears both. `modelId` /
`modelStatus` remain the owner's selection and download state. `transcription.start`
requires a recent hello **and** `runtimeReady`, so a restored/empty container
cannot mint a token that would close `4503`. A later ready hello flips it back.

`downloadActive: true` is present only while the container is downloading. If a
hello reports no active download while `modelStatus` is still `downloading` and
the download started more than 60 s ago (for example after a restart), Convex
clears it to `error` with `"The download was interrupted"` so the Download
button re-enables.

Convex re-syncs `transcriptionConfig` only when it is `not_installed` (a fresh
start with a restored model) or already refers to `loadedModelId`. A heartbeat
never silently replaces the owner's configured model with another ready model,
and a failed download of B cannot downgrade a ready A: the next hello reports A
as ready with `loadedError`. The transcriber restores `.selected` from the models
volume (written only after a model reaches ready); with no selection it tries
allowlisted models smallest-first, never largest-first. A fresh `docker compose
--profile transcription up` must have run `setup` first (or otherwise have
`TRANSCRIBER_TOKEN` set) or the container cannot authenticate its ingest, hello
or admin calls.

---

## Transcriber WebSocket protocol

Endpoint: `wss://<SITE_URL>/transcribe/ws` (nginx strips `/transcribe/` and
proxies to the container at `/ws`).

1. The client opens the socket and sends one text frame within 3 s:

   ```json
   { "type": "auth", "token": "<token from mintAudioToken*>" }
   ```

2. On success the server sends:

   ```json
   { "type": "ready", "sessionId": "<id>", "speakerKey": "user:<id>" }
   ```

3. The client streams binary frames: **16 kHz mono signed 16-bit
   little-endian PCM**, even length, at most 16 KiB per frame. A typical 100 ms
   frame is 3,200 bytes. Muting stops sending; the socket may stay open.
4. Sending `{"type":"end"}` flushes the last window and closes with `1000`. The
   client may also close normally.

Close codes:

| Code | Meaning |
| --- | --- |
| `1000` | Normal end, idle timeout or explicit `end`. |
| `4400` | Bad frame (empty, odd length, > 16 KiB). |
| `4401` | Invalid/forged/expired token. |
| `4408` | No auth frame within 3 s. |
| `4410` | This connection was replaced by a newer one for the same participant. **Clients must not auto-reconnect.** |
| `4411` | Convex permanently rejected ingest (`session ended`, `speaker removed`, invalid body). **Clients must not auto-reconnect**; the transcription is over for this socket. |
| `4429` | Too many concurrent streams for the **session**, or the pre-auth connection cap. Retryable. |
| `4503` | No model is ready. |
| `1011` | Internal error. |

A new **valid token for the same identity replaces the previous socket**: the
old socket is closed with `4410` (`reason: "replaced by a newer connection"`)
and the new one starts normally. A quick reconnect therefore no longer gets a
fatal `4429`. The browser must treat `4410` as terminal for that tab/socket (do
not auto-reconnect); `4429` remains the capacity/other-conflict path and is
retryable with backoff. `4411` is terminal too: the server answered `400
{error:"rejected"}` (session ended, speaker removed, malformed batch) and
retrying the same audio cannot succeed. `limit_req` and `limit_conn` guard the
nginx `/transcribe/` route; the connection limit is a per-peer backstop sized to
the seat ceiling, because a reverse proxy or NAT makes every participant share
one address. The transcriber's per-identity, per-session and pre-auth caps are
the real abuse controls, applied before the 3-second auth timeout.

Token format (for operators and tests, not for clients):

```
base64url(JSON({sid,cid,sub,start,iat,exp})) + "." + base64url(HMAC-SHA256)
signed message = the base64url payload text (the bytes before the dot)
key = SHA-256(TRANSCRIBER_TOKEN || 0x00 || "aulora-audio-token-v1")
```

`exp` is epoch seconds; tokens live 60 s. `start` is the transcription
session's start in epoch milliseconds. At the first frame of each window the
transcriber captures a monotonic-clock offset from `now - start`, so
`startMs`/`endMs` stay session-relative, survive a reconnect, and leave a real
gap after a mute. The transcriber checks the HMAC over
the base64url text in constant time and the expiry. Convex's ingest is the
second gate: it checks the session is active and `sub` is a real participant.
`infra/transcriber/test/fixtures/audio-token-vector.json` is the shared fixed
vector both languages assert against.

The transcriber caps concurrent streams per identity (default 1, with eviction)
and per session (default 32), enforces an idle timeout (60 s), and processes
audio in memory only. Finished segments are posted in order; the client never
posts text.

Every teardown path drains the remaining buffered partial window exactly once:
explicit `{"type":"end"}`, idle timeout, client disconnect, replacement
eviction and server shutdown (which closes the socket into the same `finally`).
The drain transcribes the partial with its own start offset and posts it, so
speech before a mute or a dropped connection is not lost. The buffer is cleared
by the flush, so the explicit-end drain and the teardown drain cannot send the
same window twice. A per-identity delivery gate owned by the stream registry
(not by a socket) assigns each batch its `seq` and posts it before the next
batch may start. The evicted socket's teardown drain and the replacement's
first batches therefore share one order: a replacement continues with the next
`seq` rather than reusing, skipping or overtaking one. A slow POST blocks later
batches (head-of-line blocking is intentional); only beyond a bounded pending
cap is a batch dropped and logged.

---

## Decisions

1. **`calls.channelId` is optional.** A standalone scheduled room has no
   channel, so `calls`, `callParticipants` and `callSignals` accept an absent
   `channelId`, and `calls` gained `scheduledCallId`. `CallSummary.channelId` is
   therefore `Id<"channels"> | null`; existing channel calls always populate it.
   Standalone calls are excluded from `calls.activeCalls` to avoid a sidebar row
   with no channel.
2. **Guest participant key.** `callParticipants` gained `guestId`, a sealed
   `guestNameCiphertext` and an opaque `guestKey`. To keep existing indexes,
   seat counting, signalling and older clients working, a guest row stores its
   guest session id in the existing `userId` field as the participant key.
   Guests are told apart by `guestId`/`isGuest`; member-facing rosters keep
   exposing `userId`, while the guest roster exposes a member's opaque
   `guestKey` and a guest's own guest session id (its engine identity). It
   never exposes a member account id, including in `signals`.
3. **Guest link uses count admissions.** `requestJoin` checks `uses < maxUses`
   but increments `uses` only on `admit`, so a flood of pending requests cannot
   exhaust a link. Pending requests are separately capped (10 per link) and
   expire after 10 minutes.
4. **Removed guests are blocked by client hash.** A removed guest's session
   token is already dead. To satisfy "blocks that guest session from
   re-requesting through the same link", `remove` stores a SHA-256 digest of the
   browser-supplied `clientId` on the link (bounded to 50) and `requestJoin`
   rejects it. A guest who clears storage gets a new id; the rate limits and the
   human lobby remain the backstop.
5. **Guest preview title.** A channel link reports the literal title
   `"Guest call"` rather than the sealed channel name, so a guest cannot learn a
   channel name they were not invited to see. A scheduled link reports the
   meeting title the host wrote.
6. **One generic link error.** Invalid, malformed, expired, revoked and
   exhausted links all throw the same `ConvexError` message so the endpoint is
   not a probing oracle.
7. **Open-window error is structured.** `ScheduledCallNotOpen` is returned as
   `ConvexError` data containing `code`, `message`, `startsAt` and `opensAt`, so
   the client can show the local start time without parsing a string. Guest
   `requestJoin` throws the same payload.
8. **No in-app open notification.** The repository has no stored in-app
   notification transport (only transient web-push wakes). The open-time job
   changes status; the Scheduled tab is the signal. This is a documented gap,
   not a silently skipped requirement.
9. **Summary endpoint DNS and ranges.** The action refuses non-HTTPS, URL
   credentials and cross-host redirects, and caps response size and time.
   Loopback, link-local (including `169.254.169.254`), unspecified, reserved
   ranges, metadata names and `localhost`-style names are **always** refused.
   IPv6 literals are expanded, including mapped/compatible IPv4 and NAT64
   (`::ffff:0:0/96`, `::/96`, `64:ff9b::/96`), and the embedded IPv4 is
   classified. `allowPrivateEndpoint` only permits RFC1918, ULA (`fc00::/7`),
   `.local`, `.internal` and single-label internal names. It cannot resolve a
   hostname before `fetch` in the Convex runtime, so a public DNS name pointing
   at a private address is not pre-screened. Only an owner with
   `ManageTranscription` can set the endpoint; the residual risk is stated in
   the transcription guide.
10. **Guest sessions are invalidated by the call.** `endCall` marks all
    admitted guest sessions on the call as left and ends the transcription
    session. A guest token cannot keep reading a dead room. Admitted sessions
    also have a hard 4-hour cap.
11. **Config singleton.** Transcription settings live in one
    `transcriptionConfig` row. The API key is sealed under that row's id and is
    never returned; `getConfig` reports only `hasApiKey`.
12. **Scheduled list is a bounded window.** `list` reads at most 200 rows in the
    requested window (default ±90 days) and returns at most 100 visible rows.
    Older records beyond the window are not promised; pass `from`/`to` to page.
13. **`calls.signals` is participant-only.** The old query let any signed-in
    member read a call's SDP/ICE rows if they knew the id. It now requires a
    seat. Response shape is unchanged.
14. **Audio tokens sign the base64url text.** Both sides HMAC the exact bytes
    before the dot and derive the key as
    `SHA-256(TRANSCRIBER_TOKEN || 0x00 || "aulora-audio-token-v1")`. A fixed
    cross-language vector (`infra/transcriber/test/fixtures/audio-token-vector.json`)
    locks the wire format. The claim set added `start` (session start, epoch
    ms) so timestamps are session-relative across reconnects.
15. **Transcript replay is per speaker; order is `startMs`.** `seq` is
    per-`(session, speaker)`. A socket replacement continues the delivery
    gate's counter (decisions 38 and 50); only a transcriber process restart
    resets it to 1, and that reset is accepted only when the batch starts
    strictly after everything stored for the speaker and overlaps nothing
    (decision 55). `lastSeq`, `lastStartMs` and the stored count are always
    high-water maxima. Segments are ordered and paginated by the
    `by_session_start` index (with `_creationTime` tie-break), not a
    session-wide counter. Per-speaker state lives in `transcriptSpeakerState`,
    and the shared session count is refreshed at most every 30 s.
16. **A reconnect replaces the identity's stream.** A new valid token closes
    the old socket with `1000` and starts a new one, so a quick reconnect never
    receives a fatal `4429`. `4429` remains for the per-session cap and the
    pre-auth flood cap and should be treated as retryable.
17. **`serviceInstalled` means "seen recently".** The transcriber posts
    `/transcription/hello` at startup and about once a minute; Convex stores
    `serviceSeenAt` in a singleton row and reports installed only within three
    minutes. The generated `TRANSCRIBER_TOKEN` alone no longer implies the
    optional profile is running.
18. **Addon disable stops the engine.** Disabling transcription schedules
    bounded ending of every active session, rejects new ingest, skips the
    summary queue and still allows `transcription.stop` for cleanup.
19. **Retention never purges "keep forever".** `purgeExpired` bounds its index
    range above zero, so an active session or a retention-0 session (no
    `retentionExpiresAt`) is never deleted by the daily cron.
20. **Offer election uses account ids (superseded by decision 46).** An
    earlier release compared opaque `negotiationKey` values, but mobile and
    older member clients compare account ids, so guest pairs could disagree.
    Decision 46 replaces that rule; the `negotiationKey` field and
    `shouldOfferByKey` helper were removed because no client read them. A
    member-side participant is addressed for signalling by `userId`; the guest
    roster keeps its opaque `participantKey` for signalling only.
21. **Disable means no LLM call.** `summarize` checks `summaryAllowed` before
    reading anything and again immediately before every external completion
    request (each chunk and the merge). A later `summaryInput` returning `null`
    aborts the whole action rather than summarizing the pages already read. An
    early return resets `pending` to `none`, so a queued job that aborted while
    the addon was off is picked up again after re-enable. `stop`,
    `stopAllActive` and the recovery cron only queue a summary when an API key
    is configured (`summaryConfigured`); with no key the status stays `none`,
    no error is written and the cron never requeues it. A `pending` row whose
    action died is re-queued by the cron only after ten minutes
    (`summaryRequestedAt`), so a live action is not duplicated. Unexpected
    exceptions move `pending` to `error` with a safe message.
22. **Restart restores the selected model.** The last model that reached ready
    is written to `/models/.selected`; startup tries it first, then the
    remaining allowlisted models smallest-first (never largest-first), using
    the Hugging Face cache layout rather than `/models/<id>`. The heartbeat
    sends `loadedModelId`/`loadedStatus`/`loadedError` explicitly and Convex
    patches a fresh `not_installed` config or repairs the same model only. A
    different ready config is the owner's choice and is never overwritten; a
    failed download of B keeps A ready and reports B's failure as `lastError`.
23. **Absolute DNS names classify like relative ones.** A single trailing dot is
    stripped before host classification, so `localhost.`, `foo.localhost.` and
    `metadata.google.internal.` cannot bypass the rules.
24. **Transcript time is wall-clock, not sample count.** A window's `startMs` is
    captured from a monotonic clock when its first frame arrives, so a mute or
    network gap appears as a gap.
25. **A reconnect replaces in place, even at capacity.** The stream registry
    swaps the identity's socket in the same session without taking a second
    slot; a different identity is still rejected at the cap.
26. **Transcript paging is an opaque index cursor.** `listSegments` returns
    `{ page, nextCursor }` over `(startMs, _creationTime)` with a constant page
    size; the summary loop walks the same cursor.
27. **Link lists and manager lookups read newest-first.** Created-at indexes
    keep a long link history from hiding the current link or the creator's
    manager status.
28. **A scheduled link follows only its own channel room.** A channel-bound
    scheduled call with no stored `callId` falls back to a live call on its
    channel only when that room is unassociated or already associated with this
    scheduled call. A room associated with another scheduled meeting is never
    entered; a guest admitted into an unassociated room claims the association
    on both rows. After the stored room ends, a replacement room on the channel
    is picked up normally.
29. **Start requires a live service.** `transcription.start` refuses unless a
    model is `ready` and the transcriber has sent a recent heartbeat; scheduled
    calls additionally refuse text/announcement channels. Cleanup deletes
    per-speaker state with the session's segments.
30. **Legacy member seats get an opaque key.** `guestCalls.admit` backfills a
    fresh `guestKey` on member participant rows that lack one (bounded by
    `MAX_CALL_SEATS`), so guest rosters and signals never fall back to the
    member's account id. The member-side fallback remains only for pre-upgrade
    rows viewed without a guest present.
31. **Ack is bounded and rate-limited.** `guestCalls.ack` rejects more than
    `GUEST_SIGNAL_ACK_MAX` ids (32, from `@aulora/core`) before reading any row
    and shares the per-guest signalling rate limit, preventing one array from
    fanning out into an unbounded sequence of `db.get` calls. The client chunks
    acks by the same constant; `signals` keeps its 256-row query cap so a row
    whose sender seat disappeared cannot starve the queue.
32. **The guest cap counts live sessions.** `admit` counts only admitted
    sessions with `expiresAt > now` against `GUEST_MAX_PER_CALL`, matching
    `lobbyList`; expired-but-unpruned rows cannot block a new guest.
33. **A mute gap flushes the partial window.** The segment stream measures the
    monotonic arrival gap. A discontinuity of at least 1 s flushes whatever
    partial window is buffered with its own start offset before starting a new
    window at the new arrival time, so a short fragment before a mute cannot be
    concatenated with speech after it.
34. **The transcriber never writes to the read-only root.** The container user's
    home is `/home/transcriber` and `HF_HOME`/`XDG_CACHE_HOME` point under the
    writable `/models` volume (`/models/hf-cache`), so downloads and caches
    never target the read-only root filesystem.
35. **Hello is presence-first and null-tolerant.** The Python builder omits
    absent optional fields instead of sending `null`. Convex records
    `serviceSeenAt` before and independently of model handling, normalises
    `null`/malformed optional hello fields to absent, and returns `200`; only a
    bad bearer or a structurally invalid body is rejected. A cold start
    therefore marks the service installed, and a bad model field cannot suppress
    the heartbeat. `/transcription/model` and `/transcription/ingest` likewise
    treat `null` optional fields (`progress`, `error`, `confidence`, `language`)
    as absent.
36. **One scheduled-room association rule.** Member joins and guest links call
    the same `resolveScheduledLiveCall` helper. A channel room is usable only
    when unassociated or already associated with the requested meeting; a room
    claimed by another meeting is never reused and a member join fails with
    `"This call belongs to another scheduled meeting"`. Reusing an unassociated
    room claims both `calls.scheduledCallId` and `scheduledCalls.callId` in one
    mutation.
37. **Summary attempts are one-shot.** Every queued run gets a fresh
    `summaryAttemptId`; completion, abort and the error transition no-op when
    the session's current id differs, so attempt A cannot overwrite attempt B's
    `ready` result or reset B's pending state. `requestSummary` returns without
    queuing while a fresh pending attempt exists; the stale-pending recovery
    still re-queues lost runs after ten minutes.
38. **Teardown drains the partial window.** Every WebSocket teardown path
    (explicit `end`, idle timeout, disconnect, replacement eviction, server
    shutdown) runs one `SegmentStream.drain()` and posts the partial with its
    own start offset. The buffer is cleared by the flush, so nothing is sent
    twice; the shared per-identity sequence counter is locked so a replacement
    continues with the next `seq`. A failed drain is logged and swallowed, and
    the registry slot is always released in a nested `finally`.
39. **Stop and call-end have a bounded finalization window.** `stop` and
    `endTranscriptionForCall` move an active session to `ending` with
    `endsAt = now + 30 s`; ingest still accepts the final buffered window from
    speakers authorized earlier in the session (a `transcriptSpeakerState` row),
    without a live seat or call, until the cutoff. Segments starting after the
    stop time + 5 s are rejected. The scheduled finalizer marks the session
    `ended` and only then queues the summary. Disabling the addon is immediate:
    no grace applies, ingest rejects while disabled, and no summary is queued.
40. **Runtime readiness is separate from the owner's selection.**
    `transcriberStatus.runtimeReady`/`runtimeModelId` are updated by every
    hello (`ready` with a valid id => ready; `not_installed` => not ready).
    `modelId`/`modelStatus` stay the owner's selection/download state.
    `transcription.start` requires a recent hello and `runtimeReady`;
    `transcription.status.runtimeReady` and
    `addons.status.transcriptionModel.runtimeReady` expose it. A cold hello
    therefore refuses Start instead of minting a token that closes `4503`.
41. **A stale download is released by hello.** The Python hello omits
    `downloadActive` when idle and sends `true` while downloading. If a hello
    reports no active download while `modelStatus` is `downloading` and the
    download started more than 60 s ago, Convex sets `error` with
    `"The download was interrupted"`. A hello proving the configured model is
    loaded still takes precedence and re-syncs it to `ready`.
42. **No-key summary aborts to `none`.** If the API key was cleared after a
    summary was queued, `summarize` uses the same abort path as a disable:
    `resetSummaryPending` clears the matching attempt, no outbound request is
    made, and the UI shows the neutral not-configured state.
43. **Replacement has its own close code.** Evicting an older socket uses
    `4410` (`"replaced by a newer connection"`), not `1000`, so a browser that
    discards `CloseEvent.reason` still knows not to auto-reconnect. `4429`
    remains the capacity/other-conflict path.
44. **Ack batching has one source of truth.** `GUEST_SIGNAL_ACK_MAX = 32` lives
    in `@aulora/core`; Convex and the client both use it. `signals` keeps the
    256-row read cap to avoid starvation, and acked rows are deleted so chunked
    acks make progress.
45. **Both settings paths stop transcription.** `addons.setEnabled` and
    `server.updateSettings` call the same `scheduleStopAllActive` helper when
    `transcriptionEnabled` becomes false, so a live session is ended and no
    summary is queued regardless of which public mutation changed the flag.
46. **The guest roster carries the complementary offer decision.** Member rows
    expose `shouldOffer: boolean` = `!shouldOffer(memberAccountId,
    guestSessionId)`, the exact complement of the account-id predicate every
    member client (web, mobile, older builds) evaluates. Guest rows omit it and
    elect among themselves with their guest session ids. This supersedes the
    opaque-key election in decision 20: mobile members evaluate
    `shouldOffer(accountId, guestSessionId)` and cannot share the guest-key
    comparison. Member account ids are still never sent to a guest.
47. **A speaker who leaves a running call gets a 30 s drain grace.**
    `removeParticipant` is the single seat-removal path (leave, stale sweep,
    switching calls, guest leave); it records `leftAt` on the speaker's
    `transcriptSpeakerState` row for the live session. Ingest from a non-seated
    speaker is accepted only with that row, before `leftAt + 30 s`, and with
    `startMs` at or before the departure offset + 5 s. A moderator removal
    (`guestCalls.remove`) sets `blocked` instead and is rejected immediately.
    Rejoining clears `leftAt`; a speaker with no state row is never accepted.
48. **A summary cannot be requested mid-call.** `requestSummary` rejects an
    `active` session with `"The call is still being transcribed"` and an
    `ending` one with `"Finishing the transcript; try again in a moment"`. This
    prevents a summary from finishing before the final drain and then being
    queued a second time by finalization.
49. **Plain http is private-network-only.** `allowPrivateEndpoint` permits
    `http:` only when the classified host is RFC1918, ULA or an internal/local
    name. A public host always requires `https:`, even with the flag, so the
    API key and transcript are never sent in cleartext to the public internet.
50. **One delivery order per speaker across reconnects.** The transcriber's
    registry owns a per-`(session, speaker)` delivery gate that assigns each
    batch its `seq` and performs the POST before the next batch starts. An
    evicted socket's teardown drain and its replacement's first batches share
    the gate, so a later sequence cannot overtake an earlier one; retries keep
    head-of-line blocking, and only past the bounded pending cap is a batch
    dropped and logged. Convex additionally accepts a lower-but-new `seq` when
    its time range does not overlap stored audio, and still rejects any stored
    `seq` as a replay.
51. **Guests count for the solo-call timer.** `distinctParticipantCount` counts
    each seat's `userId`, which is the guest session id for a guest, so a host
    with only a guest present is not alone and a member's second device still
    is. Every seat insert/remove path now calls `syncAloneTimerForCall`:
    `guestCalls.admit`/`leave`/`remove`, `scheduledCalls.join` and
    `insertScheduledCall`, plus the existing `calls.*` paths. Admit clears the
    deadline; leave/removal re-arms a fresh window rather than leaving the
    stale pre-guest deadline to end the call.
52. **The lobby reports a dead call.** `guestCalls.lobby` reads the session's
    call; when it is missing or `ended`, a `pending`/`admitted` session reports
    `left`, which the guest page already renders as "The call has ended". No new
    status value is introduced.
53. **A standalone seat survives a permission change.** `calls.get` allows the
    creator, a listed invitee (the `scheduledCalls.join` rule), or a caller who
    already holds a seat in the room, without requiring `ViewScheduledCalls`.
    Non-seated, non-invited callers are still refused.
54. **Election contract cleanup.** The roster `shouldOffer` bit (decision 46)
    is the only election contract. `shouldOfferByKey` and the member-side
    `negotiationKey` field were removed because no client read them; the guest
    roster's opaque `participantKey` remains for signalling only.
55. **Per-speaker transcript state is a high-water mark.** `lastSeq`,
    `lastStartMs` and the stored count never move backwards. A lower `seq` is
    accepted only as (a) a late arrival whose sequence numbers were never
    stored and whose range overlaps no stored segment for that speaker, or (b)
    a transcriber process restart whose first `startMs` is strictly forward and
    whose whole range overlaps nothing stored. Uniqueness across a restart is
    enforced by that time ordering rather than by `seq`; there is no `epoch`
    field. Exact replays and overlapping ranges are rejected, so re-posting an
    old batch cannot duplicate text or shrink the state.
56. **Scheduled new-room joins sync the old call's solo timer.** `prepareSeat`
    returns every call a device switched away from; `insertScheduledCall` now
    applies `syncAloneTimerForCall` to each, like the reused-room join branch.
    A two-person call left behind by that switch arms its solo window
    immediately instead of waiting for the 30 s sweep.
57. **The nginx connection cap is a per-peer backstop.** `limit_conn
    transcribe_conn 64` matches the hard seat ceiling (`MAX_CALL_SEATS`), not a
    per-user limit: behind Coolify/Traefik, Caddy, a cloud LB or NAT the
    immediate peer is one address shared by the whole call. The transcriber's
    per-identity, per-session and pre-auth caps are the real limits.
58. **Scheduled link owners can manage their own links.** `guestCalls.links`
    returns only the caller's own links when they are not a manager of the
    scheduled call (instead of throwing), and `revokeLink` accepts the link's
    creator while they hold `CreateGuestLinks` (and are not banned/timed out).
    Managers still see and revoke every link.
59. **A permanent ingest rejection is terminal.** The transcriber treats a
    4xx answer to `/transcription/ingest` (except `408`/`429`) as permanent: no
    retry, one log line without secrets, and the audio socket closes with
    `4411 ("session ended")`. Clients must not auto-reconnect it. `5xx`,
    timeouts and connection errors stay retryable with backoff, and the
    delivery gate is released so a later batch cannot be blocked. The registry
    also evicts a `DeliveryGate` when its last socket releases and no batch is
    in flight, bounding memory.
