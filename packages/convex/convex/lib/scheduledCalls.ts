import { hasPermission, Permission, scheduledCallNotOpen } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
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

/** True when the user is the creator, an invitee or holds an invited role. */
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
  const roles = await userRoles(ctx, userId);
  return roles.some((roleId) => scheduled.inviteeRoleIds.includes(roleId));
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

/** Throws unless the viewer may join a scheduled call. */
export async function requireScheduledCallJoinable(
  ctx: ReadCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
): Promise<void> {
  if (scheduled.status === "cancelled" || scheduled.status === "ended") {
    throw new ConvexError("This scheduled call has ended");
  }
  const context = await loadPermissionContext(ctx, userId);
  if (!hasPermission(workspacePermissions(context), Permission.Connect)) {
    throw new ConvexError("Missing permission");
  }
  if (scheduled.channelId !== undefined) {
    await requireChannelAccessForUser(ctx, userId, scheduled.channelId, Permission.Connect);
    return;
  }
  if (await isStandaloneInvitee(ctx, scheduled, userId)) {
    return;
  }
  throw new ConvexError("You are not invited to this call");
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
