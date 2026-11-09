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

Channel-bound calls are joinable by whoever may **Join voice** on that channel.
Only voice channels and direct/group messages can be chosen: a text or
announcement channel is refused for both scheduling and joining. Standalone
rooms are joinable by the creator, listed invitees and members of invited
roles. Once seated, a member keeps access to that room even if a later role
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

Cancelled and ended calls refuse joins. A scheduler job flips a scheduled call
to **open** at its open time; a one-minute sweep is the backstop. A call that
runs past its duration is marked ended and its room is closed.

This release has no stored in-app notification transport, so opening the window
does not send a notification. The Scheduled tab and its open state are the
signal; guests see the same start time on their lobby page.

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
4. Before the open time **Join** is disabled with the local start time. At the
   open time it creates the room on the first join and reuses it afterwards.

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
- **Also create a guest link**, if guest calls are on and you may create links.
  The link is shown once when you save.

Creators and people with **Manage scheduled calls** see a pencil to **Edit** (only
until the call opens) and an **x** to **Cancel** (after a confirmation).
Cancelling closes the room if it is open.

### Join

**Join** is disabled before the open time and the row says **This call hasn't
started yet — opens at 3:25 PM EST (in 12 min)**, in your zone. That countdown is
only a convenience taken from your device's clock. The server is the authority:
if you try to join early anyway (for example, with a clock that is wrong), it
refuses, and the page shows the same message with the real opening time. Joining
opens the call in the call window like any other call; a standalone room has no
channel, so it is named after the call.
