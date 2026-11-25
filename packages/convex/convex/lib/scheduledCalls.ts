import { hasPermission, Permission, scheduledCallNotOpen } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { loadCallSeats, removeParticipant } from "./calls";
import { requireChannelAccessForUser } from "./channels";
import {
  categoryOverridesFor,
  channelPermissions,
  loadPermissionContext,
  type PermissionContext,
  workspacePermissions,
} from "./permissions";

/**
 * Shared access and visibility rules for scheduled calls.
 *
 * - A channel-bound call is visible/joinable by whoever holds `ViewChannel` /
 *   `Connect` on that channel.
 * - A standalone room is visible/joinable by its creator, listed invitees and
 *   members of invited roles. Guests join only through an attached guest link.
 */

type ReadCtx = QueryCtx | MutationCtx;

/** Waiting-room rows deleted per batch when a call ends or is cancelled. */
const WAITING_DELETE_BATCH = 100;

/** The live active or ringing call on a channel, if any. */
export async function liveCallOnChannel(
  ctx: ReadCtx,
  channelId: Id<"channels">,
): Promise<Doc<"calls"> | null> {
  const active = await ctx.db
    .query("calls")
    .withIndex("by_channel_status", (q) => q.eq("channelId", channelId).eq("status", "active"))
    .first();
  if (active !== null) {
    return active;
  }
  return await ctx.db
    .query("calls")
    .withIndex("by_channel_status", (q) => q.eq("channelId", channelId).eq("status", "ringing"))
    .first();
}

export interface ScheduledLiveCallMatch {
  /** The call this meeting may use, or null when no usable room exists. */
  readonly call: Doc<"calls"> | null;
  /** A live channel room claimed by a different scheduled meeting. */
  readonly blockedBy: Doc<"calls"> | null;
}

/**
 * The single association rule shared by member joins and guest links:
 *
 * - a stored `scheduled.callId` that is still live is this meeting's room;
 * - a standalone room is found by `calls.scheduledCallId`;
 * - a channel room is reusable only when it is unassociated or already
 *   associated with this meeting. A room claimed by another scheduled meeting
 *   is reported as `blockedBy` and never reused.
 */
export async function resolveScheduledLiveCall(
  ctx: ReadCtx,
  scheduled: Doc<"scheduledCalls">,
): Promise<ScheduledLiveCallMatch> {
  if (scheduled.callId !== undefined) {
    const stored = await ctx.db.get(scheduled.callId);
    if (stored !== null && stored.status !== "ended") {
      if (stored.scheduledCallId === undefined || stored.scheduledCallId === scheduled._id) {
        return { call: stored, blockedBy: null };
      }
      return { call: null, blockedBy: stored };
    }
  }
  if (scheduled.channelId === undefined) {
    const rows = await ctx.db
      .query("calls")
      .withIndex("by_scheduled_call", (q) => q.eq("scheduledCallId", scheduled._id))
      .take(5);
    return { call: rows.find((row) => row.status !== "ended") ?? null, blockedBy: null };
  }
  const candidate = await liveCallOnChannel(ctx, scheduled.channelId);
  if (candidate === null) {
    return { call: null, blockedBy: null };
  }
  if (candidate.scheduledCallId === undefined || candidate.scheduledCallId === scheduled._id) {
    return { call: candidate, blockedBy: null };
  }
  return { call: null, blockedBy: candidate };
}

export async function findScheduledCall(
  ctx: ReadCtx,
  scheduledCallId: Id<"scheduledCalls">,
): Promise<Doc<"scheduledCalls"> | null> {
  return await ctx.db.get(scheduledCallId);
}

async function userRoles(ctx: ReadCtx, userId: string): Promise<readonly string[]> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return member?.roleIds ?? [];
}

/** Pure form of {@link isStandaloneInvitee}, for callers that already hold the roles. */
export function isListedWithRoles(
  scheduled: Doc<"scheduledCalls">,
  userId: string,
  roleIds: readonly string[],
): boolean {
  return (
    scheduled.createdBy === userId ||
    scheduled.inviteeUserIds.includes(userId) ||
    roleIds.some((roleId) => scheduled.inviteeRoleIds.includes(roleId))
  );
}

/** The user's role refs, read once so a list can reuse them for every row. */
export async function viewerRoleIds(ctx: ReadCtx, userId: string): Promise<readonly string[]> {
  return await userRoles(ctx, userId);
}

/**
 * True when the user is the creator, an invitee or holds an invited role. Used
 * for standalone rooms and for channel calls that are invite-only.
 */
export async function isStandaloneInvitee(
  ctx: ReadCtx,
  scheduled: Doc<"scheduledCalls">,
  userId: string,
): Promise<boolean> {
  if (scheduled.createdBy === userId || scheduled.inviteeUserIds.includes(userId)) {
    return true;
  }
  if (scheduled.inviteeRoleIds.length === 0) {
    return false;
  }
  return isListedWithRoles(scheduled, userId, await userRoles(ctx, userId));
}

/** Channel permissions for a channel-bound target, or workspace permissions. */
export async function scheduledCallPermissions(
  ctx: ReadCtx,
  context: PermissionContext,
  scheduled: Doc<"scheduledCalls">,
): Promise<bigint> {
  if (scheduled.channelId === undefined) {
    return workspacePermissions(context);
  }
  const channel = await ctx.db.get(scheduled.channelId);
  if (channel === null) {
    throw new ConvexError("Channel not found");
  }
  return channelPermissions(context, channel, await categoryOverridesFor(ctx, channel));
}

/** Throws unless the viewer may see a scheduled call. */
export async function requireScheduledCallVisible(
  ctx: ReadCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
  flag: bigint = Permission.ViewScheduledCalls,
): Promise<void> {
  const context = await loadPermissionContext(ctx, userId);
  // A standalone room has no channel permission surface. Its creator and
  // listed invitees may see it under the same rule that lets them join it,
  // without holding ViewScheduledCalls (which only gates the Scheduled tab).
  if (scheduled.channelId === undefined && (await isStandaloneInvitee(ctx, scheduled, userId))) {
    return;
  }
  if (!hasPermission(await scheduledCallPermissions(ctx, context, scheduled), flag)) {
    throw new ConvexError("Missing scheduled-call permission");
  }
  if (scheduled.channelId !== undefined) {
    const channel = await ctx.db.get(scheduled.channelId);
    if (channel === null) {
      throw new ConvexError("Channel not found");
    }
    const permissions = channelPermissions(
      context,
      channel,
      await categoryOverridesFor(ctx, channel),
    );
    if (!hasPermission(permissions, Permission.ViewChannel)) {
      throw new ConvexError("You cannot see this scheduled call");
    }
    return;
  }
  if (await isStandaloneInvitee(ctx, scheduled, userId)) {
    return;
  }
  if (hasPermission(workspacePermissions(context), Permission.ManageScheduledCalls)) {
    return;
  }
  throw new ConvexError("You cannot see this scheduled call");
}

/**
 * A standalone room is always invite-only; a channel call is invite-only when
 * its creator turned the option on. Absent `inviteOnly` means false.
 */
export function isInviteOnly(scheduled: Doc<"scheduledCalls">): boolean {
  return scheduled.channelId === undefined || scheduled.inviteOnly === true;
}

/** The viewer's waiting-room row for one call, if any. */
export async function findWaitingRow(
  ctx: ReadCtx,
  scheduledCallId: Id<"scheduledCalls">,
  userId: string,
): Promise<Doc<"scheduledCallWaiting"> | null> {
  return await ctx.db
    .query("scheduledCallWaiting")
    .withIndex("by_call_user", (q) => q.eq("scheduledCallId", scheduledCallId).eq("userId", userId))
    .first();
}

/** A live admission: a host let this member in, and it has not lapsed. */
export async function findAdmission(
  ctx: ReadCtx,
  scheduledCallId: Id<"scheduledCalls">,
  userId: string,
  now: number = Date.now(),
): Promise<Doc<"scheduledCallWaiting"> | null> {
  const row = await findWaitingRow(ctx, scheduledCallId, userId);
  return row !== null && row.status === "admitted" && row.expiresAt > now ? row : null;
}

/**
 * Throws unless the user holds `Connect` (workspace, and the channel for a
 * channel-bound call) and the call can still be joined. Returns the user's
 * workspace permissions so callers can read the administrator bit.
 */
export async function requireScheduledCallConnect(
  ctx: ReadCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
): Promise<bigint> {
  if (scheduled.status === "cancelled" || scheduled.status === "ended") {
    throw new ConvexError("This scheduled call has ended");
  }
  const context = await loadPermissionContext(ctx, userId);
  const workspace = workspacePermissions(context);
  if (!hasPermission(workspace, Permission.Connect)) {
    throw new ConvexError("Missing permission");
  }
  if (scheduled.channelId !== undefined) {
    await requireChannelAccessForUser(ctx, userId, scheduled.channelId, Permission.Connect);
  }
  return workspace;
}

export interface ScheduledCallStanding {
  readonly administrator: boolean;
  /** The creator, a listed invitee or a member of an invited role. */
  readonly listed: boolean;
  /** A host already let the member in. */
  readonly admitted: boolean;
  readonly inviteOnly: boolean;
  /** May join without knocking, ignoring the open window. */
  readonly allowed: boolean;
}

/** Why (or whether) a member may join, without throwing. */
export async function scheduledCallStanding(
  ctx: ReadCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
  workspace: bigint,
  now: number = Date.now(),
): Promise<ScheduledCallStanding> {
  const administrator = isAdministrator(workspace);
  const inviteOnly = isInviteOnly(scheduled);
  const listed = await isStandaloneInvitee(ctx, scheduled, userId);
  const admitted = (await findAdmission(ctx, scheduled._id, userId, now)) !== null;
  return {
    administrator,
    listed,
    admitted,
    inviteOnly,
    allowed: !inviteOnly || administrator || listed || admitted,
  };
}

/**
 * Throws unless the viewer may join a scheduled call. `Connect` is required of
 * everyone. A call that is not invite-only admits any channel member; an
 * invite-only call (every standalone room) admits administrators, the creator,
 * invitees and members a host admitted from the waiting room.
 */
export async function requireScheduledCallJoinable(
  ctx: ReadCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
  now: number = Date.now(),
): Promise<void> {
  const workspace = await requireScheduledCallConnect(ctx, userId, scheduled);
  if (!isInviteOnly(scheduled) || isAdministrator(workspace)) {
    return;
  }
  if (await isStandaloneInvitee(ctx, scheduled, userId)) {
    return;
  }
  if ((await findAdmission(ctx, scheduled._id, userId, now)) !== null) {
    return;
  }
  throw new ConvexError(
    scheduled.channelId === undefined
      ? "You are not invited to this call"
      : "This call is invite-only. Ask a host to let you in.",
  );
}

/**
 * Claims an unassociated channel room for a scheduled meeting. For an
 * invite-only meeting, members already seated who may not join it lose their
 * seat (they can still ask to join from the waiting room). Guests stay: a guest
 * link is the sanctioned way into an invite-only call. Returns the removed
 * user ids so callers can re-sync timers.
 */
export async function claimChannelRoomForScheduled(
  ctx: MutationCtx,
  call: Doc<"calls">,
  scheduled: Doc<"scheduledCalls">,
  now: number = Date.now(),
): Promise<readonly string[]> {
  await ctx.db.patch(call._id, { scheduledCallId: scheduled._id, updatedAt: now });
  if (!isInviteOnly(scheduled)) {
    return [];
  }
  const removed: string[] = [];
  const seats = await loadCallSeats(ctx, call._id);
  for (const userId of new Set(
    seats.filter((seat) => seat.guestId === undefined).map((seat) => seat.userId),
  )) {
    const context = await loadPermissionContext(ctx, userId);
    const standing = await scheduledCallStanding(
      ctx,
      userId,
      scheduled,
      workspacePermissions(context),
      now,
    );
    if (!standing.allowed) {
      await removeParticipant(ctx, call, userId);
      removed.push(userId);
    }
  }
  return removed;
}

/** Enforces the server-side open window. The UI timer is only cosmetic. */
export function assertScheduledCallOpen(
  scheduled: Doc<"scheduledCalls">,
  now: number = Date.now(),
): void {
  const opensAt = scheduled.startsAt - scheduled.openLeadMinutes * 60_000;
  if (now >= opensAt) {
    return;
  }
  throw new ConvexError(scheduledCallNotOpen(scheduled.startsAt, scheduled.openLeadMinutes));
}

/**
 * True when the permissions include `Administrator` (held through a role, or
 * implied by workspace ownership, which resolves to every permission). The bit
 * is read directly because `hasPermission` short-circuits for administrators.
 */
export function isAdministrator(permissions: bigint): boolean {
  return (permissions & Permission.Administrator) !== 0n;
}

/**
 * Enforces the open window for one user. A workspace administrator, or a member
 * a host let in from the waiting room, may join before it; everyone else,
 * guests included, gets the typed `ScheduledCallNotOpen` error. Returns
 * `early: true` when the join happens before `opensAt`, so callers can leave the
 * call `scheduled` for everyone else.
 */
export async function assertScheduledCallOpenForUser(
  ctx: ReadCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
  now: number = Date.now(),
): Promise<{ readonly early: boolean }> {
  const opensAt = scheduled.startsAt - scheduled.openLeadMinutes * 60_000;
  // A call that was already open stays joinable even if an edit moved its
  // start later, so its live room does not turn people away.
  if (scheduled.status === "open" || now >= opensAt) {
    return { early: false };
  }
  const context = await loadPermissionContext(ctx, userId);
  if (isAdministrator(workspacePermissions(context))) {
    return { early: true };
  }
  if ((await findAdmission(ctx, scheduled._id, userId, now)) !== null) {
    return { early: true };
  }
  assertScheduledCallOpen(scheduled, now);
  return { early: true };
}

/**
 * Removes the member's pending waiting-room row once they are in. An admitted
 * row stays so a rejoin after a disconnect keeps working while the call is live.
 */
export async function consumeWaitingRow(
  ctx: MutationCtx,
  scheduledCallId: Id<"scheduledCalls">,
  userId: string,
): Promise<void> {
  const row = await findWaitingRow(ctx, scheduledCallId, userId);
  if (row !== null && row.status !== "admitted") {
    await ctx.db.delete(row._id);
  }
}

/**
 * Deletes one bounded batch of a call's waiting-room rows. Returns true when a
 * batch was full, so the caller can schedule a continuation.
 */
export async function deleteWaitingRows(
  ctx: MutationCtx,
  scheduledCallId: Id<"scheduledCalls">,
  batch: number = WAITING_DELETE_BATCH,
): Promise<boolean> {
  let more = false;
  for (const status of ["waiting", "admitted", "declined"] as const) {
    const rows = await ctx.db
      .query("scheduledCallWaiting")
      .withIndex("by_call_status", (q) =>
        q.eq("scheduledCallId", scheduledCallId).eq("status", status),
      )
      .take(batch);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === batch) {
      more = true;
    }
  }
  return more;
}

/**
 * True when the viewer may manage (edit/cancel) the scheduled call: a manager
 * holding `ManageScheduledCalls`, or the creator who still holds `ScheduleCalls`
 * (ownership alone is not a permission).
 */
export function mayManageScheduledCall(
  userId: string,
  permissions: bigint,
  scheduled: Doc<"scheduledCalls">,
): boolean {
  if (hasPermission(permissions, Permission.ManageScheduledCalls)) {
    return true;
  }
  return scheduled.createdBy === userId && hasPermission(permissions, Permission.ScheduleCalls);
}
