# Scheduled calls

Scheduled calls add a **Scheduled** tab for planning a call that opens a
configurable time before it starts. The addon is **off by default**, and the tab
appears only when it is on and the member holds **View scheduled calls**.

## What a scheduled call is

- `title` and `description` are sealed at rest.
- `startsAt` is stored in UTC milliseconds. Every client renders it in the
  viewer's **local time zone** and shows the zone name. The server never stores
  local time.
- `durationMinutes` is optional.
- `openLeadMinutes` is how long before the start the call accepts joins. The
  default is 5 and the allowed range is 0–120.
- A call is either **channel-bound** (a voice channel or a DM/group DM the
  scheduler can access) or a **standalone room** with invited people and/or
  roles. There is no recurrence in v1.

Channel-bound calls are joinable by whoever may **Join voice** on that channel,
unless the call is **invite only** (see below). Only voice channels and
direct/group messages can be chosen: a text or announcement channel is refused
for both scheduling and joining. Standalone rooms are always invite only: they
are joinable by the creator, listed invitees, members of invited roles and
administrators. Once seated, a member keeps access to that room even if a later role
change removes **View scheduled calls**; the call window uses the held seat, not
the Scheduled tab permission. Guests join only through a guest link attached to
the scheduled call; the person who created a guest link can list and revoke
their own before the room opens.

Two meetings may share a channel, but each keeps its own room. A join reuses a
live channel room only when it is unassociated or already belongs to that
meeting. If the only live room belongs to another scheduled meeting, the join is
refused with **This call belongs to another scheduled meeting** rather than
seating you in the wrong meeting. A free channel room is claimed by the meeting
on first reuse, so a guest link for a different meeting cannot take it later.

## The open window is enforced by the server

Before `startsAt − openLeadMinutes`, a join is refused with a typed,
user-presentable error (`ScheduledCallNotOpen`) that carries the start and open
times. The UI shows **This call hasn't started yet** with the local start time.
The countdown in the UI is cosmetic. The same rule applies to guest links.

Workspace owners and administrators can join before the open window, and the
Scheduled tab shows **Join early** for them. A member a host lets in from the
waiting room (below) can also be early. An early join does not open the call for
anyone else. It stays scheduled and opens to everyone at the normal time, and
guests are still refused until then. **Join voice** rules still apply. The same
window, invite and admission checks run on every path into the room, including
starting a call from the channel itself, so a channel member cannot walk into a
scheduled room before it opens or past its invite list. A refusal is a
user-presentable message, and the not-open refusal keeps the typed
`ScheduledCallNotOpen` payload.

Cancelled and ended calls refuse joins. A scheduler job flips a scheduled call
to **open** at its open time; a one-minute sweep is the backstop. A call that
runs past its duration is marked ended and its room is closed.

This release has no stored in-app notification transport, so opening the window
does not send a notification. The Scheduled tab and its open state are the
signal; guests see the same start time on their lobby page.

## Invite only

A channel call can be made **invite only** when it is scheduled or edited. The
**Invite only** toggle in the schedule dialog reveals the same people and roles
picker a standalone room uses. The list may be empty, in which case only the
creator and administrators can get in, plus anyone a host admits. A member may
join an invite-only call when any of these holds, in addition to **Join voice**:

- they are a workspace administrator (this includes standalone rooms they are
  not invited to);
- they created the call;
- they are on the list, directly or through an invited role;
- a host admitted them from the waiting room.

Channel members can still see an invite-only call on the Scheduled tab, so they
can ask to join. While an invite-only call's room is live, members who are not
allowed in cannot use that channel's room. If an ordinary call is already running
in the channel when the meeting starts, the meeting takes over that room and
members who are not allowed in are removed from it; they can ask to join from
the Scheduled tab. Members already in the room when a host later turns on
**Invite only** keep their seats. Guest links are unchanged: guests use
their own lobby and are not affected. The setting is optional and additive; a
call from before this release, or a client that omits it, is not invite only.

## The waiting room

Members who cannot walk in yet wait on the Scheduled tab instead of being
refused:

- **Wait to join** (a member who is allowed in, before the call opens): the row
  says *You'll join automatically when it opens at 3:25 PM EST*. When the call
  opens the member is joined without a click. A host can also **Let in** an early
  arrival before the open time, or **Let everyone in**.
- **Ask to join** (a member who is not allowed in an invite-only call): the row
  says *Waiting for a host to let you in*. A host must **Admit** them. Admission
  lets them past the invite list for this call only, and a rejoin after a
  disconnect keeps working while the call is live.
- A host can **Decline**. The member sees *A host declined your request* and
  cannot ask again for a minute.

Waiting survives switching channels or tabs, because the waiting state is
watched at the app level. A member who is already in another call is never moved
out of it automatically; their row shows **Join** instead. **Leave** withdraws a
request.

Hosts are administrators and anyone who can manage the call (its creator with
**Schedule calls**, or **Manage scheduled calls**). They get a prompt in the call
they are in, and a compact list with **Admit**, **Decline** and **Let everyone
in** on the call's row in the Scheduled tab for calls that open within a day, so
they can let people in before joining themselves. Each decision is written to
the audit log. At most 25 members wait on one call at once; unanswered requests
lapse after 10 minutes (an early arrival waits until shortly after the open
time, up to 12 hours), and every row is deleted when the call ends or is
cancelled.

## Editing and the solo-call timeout

A call can be edited while it is **scheduled** or **open**, never once it has
ended or been cancelled. Everything stays editable: the title, description, start,
length, open lead, invitees and the invite-only setting. Only a start or length
that actually changes is checked against the clock, so renaming a call that has
already started works. Moving the start of an open call with a live room keeps it
open and the room running. An open call with no room that is moved into the
future goes back to scheduled and opens at the new time.

A room that belongs to a scheduled call never runs the solo-call timeout during
its window, which ends at `startsAt` plus the duration (four hours when no length
was set). The host can wait alone as long as the window lasts, and the room is
closed after it by the usual sweep. Ordinary channel calls keep the timeout.

## Permissions and limits

| Permission | Allows |
| --- | --- |
| View scheduled calls | See the Scheduled tab, limited to calls the viewer is invited to or may join, plus their own. |
| Schedule calls | Create, edit and cancel own scheduled calls. |
| Manage scheduled calls | Edit and cancel anyone's scheduled calls. |

Owners and administrators hold all three implicitly. A creator needs
**Schedule calls** to edit or cancel their own call; simply owning it is not
enough. **Manage scheduled calls** also works, and a banned or timed-out member
cannot cancel. **View scheduled calls** is the one call-addon permission
granted to `@everyone`, once, through a stored migration marker, so the tab can
exist without an explicit grant. Enabling or disabling the addon requires
**Manage workspace**.

Limits: a cap on upcoming calls per workspace and per creator, title and
description length limits, a start time that must be in the future (small
tolerance) and within a year, and a bounded list window. The server enforces all
of them.

## Create and join

1. Open **Scheduled** and choose **New call**.
2. Enter a title, the local date and time, the open-before minutes, and either a
   channel or standalone invitees.
3. Optionally attach a guest link from the same dialog.
4. Before the open time **Join** is disabled with the local start time, or the
   row offers **Wait to join** (see the waiting room). At the open time it
   creates the room on the first join and reuses it afterwards.

The tab is part of the web and desktop clients. Native mobile screens are a
follow-up and not part of v1.

## Guests

A guest link can point at a scheduled call. Its expiry never extends past the
call's end plus a short grace. Before the window a guest sees **The call hasn't
started yet** with the start time; the lobby flow is the same as for a channel
call. See [Guest calls](guest-calls.md). The link icon on a scheduled call's row
opens the guest-link dialog for that call: it lists the call's links (uses and
end time) and revokes them even before the call opens.

## Operator notes

Scheduled calls need no new container or environment variable. Turn the addon on
in **Workspace settings → Addons**. The setup container runs the idempotent
permission migration on every deploy; a later deliberate removal of **View
scheduled calls** from `@everyone` is not undone.

## Using it in the app

### The Scheduled tab

With the addon on and **View scheduled calls**, a **Scheduled** entry appears in
the sidebar. It lists calls you are invited to or may join, plus your own:

- **Upcoming**, grouped by day (*Today*, *Tomorrow*, then the date). Each row
  shows the start time with your time zone name, the length, where it happens and
  a status: *Open now*, or *Cancelled*. A **Past** section holds finished and
  cancelled calls, collapsed by default.
- Times use **your** time zone, shown at the top of the page, and follow daylight
  saving. Someone in another zone sees the same call at their own local time.

### Schedule a call

With **Schedule calls** (or **Manage scheduled calls**), choose **Schedule**:

- **Title** (required) and an optional **Description**.
- **Date and time** in your own time zone. Under the field you see the exact
  start with its zone name, so a call created across a daylight-saving change is
  never ambiguous. The start must be in the future and within a year.
- **How long** (optional) and **People can join**: how many minutes before the
  start the call opens (0 to 120; 5 by default).
- **Where**: a **Standalone room** for the people and roles you invite, or **In a
  channel** (a voice channel, direct message or group message you can use). The
  channel cannot be changed after scheduling.
- **Invite only**, for a channel call: reveals the picker for the people and roles
  who can join. Standalone rooms always use the picker.
- **Also create a guest link**, if guest calls are on and you may create links.
  The link is shown once when you save.

Creators and people with **Manage scheduled calls** see a pencil to **Edit** (until
the call ends) and an **x** to **Cancel** (after a confirmation). Cancelling
closes the room if it is open.

### Join

**Join** is disabled before the open time and the row says **This call hasn't
started yet — opens at 3:25 PM EST (in 12 min)**, in your zone. That countdown is
only a convenience taken from your device's clock. The server is the authority:
if you try to join early anyway (for example, with a clock that is wrong), it
refuses, and the page shows the same message with the real opening time. Joining
opens the call in the call window like any other call; a standalone room has no
channel, so it is named after the call.
