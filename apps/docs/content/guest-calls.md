# Guest calls

Guest calls let a member invite someone who has no account to one call through a
link and a host-approved lobby. The addon is **off by default**.

## Identity and isolation

A guest does **not** get a Better Auth user, a Convex JWT, a workspace
membership, a member row or any account. Giving a guest an authenticated
identity would make every function that only checks "signed in" reachable.

Guests call a small, separate set of public functions (`guestCalls.*`) that take
an opaque guest session token as an argument. The server stores only the
SHA-256 digest of that token. Those functions expose only what the guest needs
for the one call they were admitted to:

- the roster (display names, mute and camera flags) addressed by opaque
  per-call keys, never member account ids;
- WebRTC signalling to and from the participants;
- their own mute/camera changes, heartbeat and leave;
- the transcription indicator and an audio token when transcription is on.

They never return channel names, workspace data, files, chat or member ids. A
guest token cannot be used on any member function, and one guest's token cannot
read another call.

Guests are always shown with a **Guest** badge, so a guest cannot impersonate a
member by choosing a similar display name.

Offer election follows the member's account-id rule on every app version, so a
member on current web, mobile, or an older client can host a guest. The guest's
roster carries the complementary decision (never the member's account id), so
exactly one side creates the offer for each member↔guest pair; guests elect
among themselves with their own session ids.

## Links

A member with **Create guest links**, the addon enabled and access to the call
creates a link. The link is:

```
<SITE_URL>/call/guest#<token>
```

The token travels in the URL **fragment**, so it never reaches server logs, the
HTTP `Referer` or an intermediary. The page sets `noindex` and no-referrer.

- Defaults: expires in one hour (maximum seven days, and never later than the
  end of a linked scheduled call plus a short grace), up to five uses (maximum
  25).
- Only the SHA-256 digest is stored. The plaintext is shown **once**.
- Invalid, expired, revoked and exhausted links all return the **same generic
  error**, so links cannot be probed.
- Anyone with the link can ask to join, but nobody enters without a member
  admitting them.
- Caps: active links per call and per creator, and at most eight guests in one
  call (also bounded by the call seat cap). Guests count toward the mesh size.

Revoking a link stops new requests but does not eject guests already admitted.
Removing a guest ejects them and blocks that browser from re-requesting through
the same link.

A link created for a scheduled call can also be listed and revoked from the
**Scheduled** tab, not only from the live call; the person who created it can do
so before the room opens, while other people's links stay hidden unless they
manage guest access. For a channel-bound scheduled
call the link targets both the scheduled window and its channel, so the live
call dialog sees it too, and the link opens if the host starts the room from the
channel even before anyone joins through the scheduled row. Two scheduled
meetings may share a channel, but a link only ever enters its own room: a room
already claimed by another meeting is never offered to the guest. When the
first room ends, a replacement room on that channel opens normally.

An unanswered lobby request expires after about ten minutes and an admitted
visit after at most four hours. The guest page reports either as **expired**
as soon as the deadline passes; it does not wait for the hourly cleanup.

## Lobby

1. The guest opens the link and sees only the call title and whether it is open.
2. They enter a display name (1–40 characters, required) and an optional
   affiliation (0–60). The server normalizes Unicode, strips control and
   bidirectional-override characters, collapses whitespace and rejects an empty
   result.
3. **Ask to join** creates a pending request and returns the session token once.
   Requests are rate-limited per link and per address, capped per link, and
   expire after about ten minutes.
4. Members in the call who hold **Manage guest access**, or the link's creator,
   see a live **N people waiting** prompt and can admit or deny.
5. An admitted guest gets a session valid until the call ends or at most four
   hours. Their seat follows the normal participant heartbeat sweep.

If a linked scheduled call has not opened yet, the guest sees **The call hasn't
started yet** with the start time. Before the window the server refuses the
request even if the page's timer was tampered with.

Guests can use microphone and camera. They cannot share a screen, start
transcription or recording, admit other guests or create links.

## Permissions

| Permission | Allows |
| --- | --- |
| Create guest links | Create a guest link for a call the member can join. |
| Manage guest access | Admit, deny or remove guests in any call, and revoke any link. |

Owners and administrators hold both implicitly. Enabling or disabling the addon
requires **Manage workspace**. The creator of a link who is currently in that
call may also admit or deny through it.

## What guests and hosts should know

- A guest is a real WebRTC peer, so other participants can see their IP address
  as in any WebRTC call. A TURN relay reduces direct exposure but does not make
  the call anonymous.
- The host's server sees the guest's requests, including their IP, in its logs
  and rate-limit state. The link token itself never reaches the server from the
  page.
- A guest with the link and an admitted session can see the call roster and
  media flags, but no channel or workspace data.
- The transcription indicator and opt-out notice are shown to guests. A guest's
  audio token is bound to their guest session; guests never get transcript read
  access.
- Links are bearer secrets. Treat a copied link as permission to *ask* to join,
  not permission to enter.

## Operator notes

Guest calls need no new container. They use the existing web origin and Convex.
Turn the addon on in **Workspace settings → Addons**, then grant the two
permissions where wanted. No environment variable is specific to guest calls;
`MAX_CALL_SEATS`-style seat caps are enforced from workspace call settings.

## Using it in the app

### Invite a guest

If the addon is on and you have **Create guest links**, a **Invite a guest**
control appears in the call controls while you are in a call. It opens a dialog:

1. Choose how long the link works (15 minutes to 7 days; 1 hour by default) and
   how many people it can admit (1 to 25; 5 by default).
2. Choose **Create link**. The link is shown **once**, with a **Copy** button.
   Close the dialog and it cannot be shown again: the server keeps only a hash.
   Create another if you lose it.
3. If you may manage the lobby, the dialog also lists the call's links with how
   many people each has admitted, when it ends and its state (*Active*,
   *Revoked*, *Expired*, *Used up*), and **Revoke** for active ones. Revoking
   stops new requests; people already admitted stay until removed.

For a call that has not started yet, use the link icon on its row in the
**Scheduled** tab, or tick **Also create a guest link** when scheduling. That
dialog lists the scheduled call's links too, so you can see their uses and
expiry and revoke one even before the call opens. After you create a link its
address is shown once at the top; the list stays below it.

### Admit people

People who may answer guests (**Manage guest access**, or whoever created the
link while they are in the call) see a panel at the top right of the call:

- **N people are waiting**, each with their name and, if they gave one, their
  company or role. **Admit** or **Deny** each by name. The panel updates live.
- **Guests in this call**, each with a **Guest** badge and a remove button.
  Removing a guest ends their visit and stops that browser from asking again
  through the same link.

Everyone else in the call never sees this panel. Guests appear on the call grid
with a **Guest** badge.

### What a guest sees

The link is `…/call/guest#<token>`. The token is in the URL fragment, which
browsers never send to a server or in a `Referer`. The page reads it, removes it
from the address bar and history, keeps it in memory only, never logs it, and
asks search engines not to index it. Once admitted, the guest's session token is
kept in that browser tab's session storage so a reload resumes the visit; it is
removed when the visit ends. It is not part of the signed-in app: a guest
has no account and sees no channels, chat, files or workspace data.

The guest page walks through, in order:

1. **A lobby** with the call's title, **Your name** (required), a company or role
   (optional), a camera and microphone check (nothing is requested until they
   press **Check camera and microphone**), and **Ask to join**.
2. **Waiting to be let in**, with **Cancel**. If the call ends while you are
   waiting, the page moves straight to *The call has ended for you* instead of
   leaving you on the waiting screen.
3. **The call**: people, microphone, camera and **Leave**. No chat, no screen
   sharing and no deafen. If the call is being transcribed, the same notice with
   **Opt out** is shown to guests.

Other outcomes are plain full-page messages: *You weren't let in*, *You were
removed from the call*, *Your request expired* (nobody answered within ten
minutes; with **Ask again**), *The call has ended for you* (the call is over, or
your visit reached its time limit), and *This guest link isn't available*. The last one is the same for
every unusable link (invalid, expired, revoked, used up), so a link cannot be
probed to learn which. For a scheduled call that has not opened, the lobby says
**The call hasn't started yet** with the opening time in the guest's own time
zone, and **Ask to join** stays disabled.

Guests need a modern browser, a secure (`https`) address for the microphone and
camera, and, to reach members behind strict networks, the workspace's TURN relay
if one is configured. A guest's network address is visible to the other
participants, as in any WebRTC call.
