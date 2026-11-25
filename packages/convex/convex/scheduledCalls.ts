import {
  clampOpenLeadMinutes,
  hasPermission,
  isBotUserId,
  Permission,
  SCHEDULED_CALL_DESCRIPTION_MAX,
  SCHEDULED_CALL_LIST_LIMIT,
  SCHEDULED_CALL_LIST_WINDOW_MS,
  SCHEDULED_CALL_MAX_DURATION_MINUTES,
  SCHEDULED_CALL_MAX_HORIZON_MS,
  SCHEDULED_CALL_MAX_OPEN_LEAD_MINUTES,
  SCHEDULED_CALL_MAX_UPCOMING_CREATOR,
  SCHEDULED_CALL_MAX_UPCOMING_WORKSPACE,
  SCHEDULED_CALL_MIN_DURATION_MINUTES,
  SCHEDULED_CALL_START_TOLERANCE_MS,
  SCHEDULED_CALL_TITLE_MAX,
  SCHEDULED_WAITING_DECLINE_COOLDOWN_MS,
  SCHEDULED_WAITING_EARLY_MAX_MS,
  SCHEDULED_WAITING_GRACE_MS,
  SCHEDULED_WAITING_KNOCK_TTL_MS,
  SCHEDULED_WAITING_MAX_ADMITTED,
  SCHEDULED_WAITING_MAX_PENDING,
  type ScheduledWaitingKind,
  scheduledCallEndsAt,
  scheduledCallOpensAt,
} from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import {
  assertCallableKind,
  assertClientId,
  endCall,
  insertParticipant,
  prepareSeat,
  syncAloneTimerForCall,
} from "./lib/calls";
import { requireChannelAccessForUser } from "./lib/channels";
import { randomToken } from "./lib/crypto";
import { loadPermissionContext, requireWorkspaceContext } from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import {
  assertScheduledCallOpenForUser,
  claimChannelRoomForScheduled,
  consumeWaitingRow,
  deleteWaitingRows,
  findScheduledCall,
  findWaitingRow,
  isAdministrator,
  isInviteOnly,
  isListedWithRoles,
  mayManageScheduledCall,
  requireScheduledCallConnect,
  requireScheduledCallJoinable,
  requireScheduledCallVisible,
  resolveScheduledLiveCall,
  scheduledCallPermissions,
  scheduledCallStanding,
  viewerRoleIds,
} from "./lib/scheduledCalls";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";

/**
 * The optional scheduled-calls addon (`api.scheduledCalls.*`).
 *
 * A scheduled call is either channel-bound (join rules are the channel's
 * `Connect`) or a standalone room with invitees. Every join is gated on the
 * server-side open window; the client's countdown is cosmetic.
 */

async function requireAddon(ctx: QueryCtx | MutationCtx): Promise<void> {
  const server = await ctx.db.query("server").first();
  if (server?.settings.scheduledCallsEnabled !== true) {
    throw new ConvexError("Scheduled calls are disabled");
  }
}

async function scheduledContent(scheduled: Doc<"scheduledCalls">): Promise<{
  title: string;
  description: string;
}> {
  const context = { scope: "scheduledCall", recordId: scheduled._id };
  return {
    title: await openContent(context, scheduled.titleCiphertext),
    description:
      scheduled.descriptionCiphertext === undefined
        ? ""
        : await openContent(context, scheduled.descriptionCiphertext),
  };
}

function validateStart(startsAt: number, now: number): void {
  if (!Number.isFinite(startsAt)) {
    throw new ConvexError("Start time is invalid");
  }
  if (startsAt < now - SCHEDULED_CALL_START_TOLERANCE_MS) {
    throw new ConvexError("Start time must be in the future");
  }
  if (startsAt > now + SCHEDULED_CALL_MAX_HORIZON_MS) {
    throw new ConvexError("Start time must be within the next year");
  }
}

function validateDuration(durationMinutes: number | undefined): void {
  if (
    durationMinutes !== undefined &&
    (durationMinutes < SCHEDULED_CALL_MIN_DURATION_MINUTES ||
      durationMinutes > SCHEDULED_CALL_MAX_DURATION_MINUTES)
  ) {
    throw new ConvexError(
      `Duration must be ${SCHEDULED_CALL_MIN_DURATION_MINUTES}–${SCHEDULED_CALL_MAX_DURATION_MINUTES} minutes`,
    );
  }
}

function validateTimes(startsAt: number, durationMinutes: number | undefined, now: number): void {
  validateStart(startsAt, now);
  validateDuration(durationMinutes);
}

function validateText(value: string, name: string, max: number, required = true): string {
  const trimmed = value.trim();
  if ((required && trimmed.length === 0) || value.length > max) {
    throw new ConvexError(`${name} must be ${required ? "1" : "0"}–${max} characters`);
  }
  return trimmed;
}

async function upcomingCounts(
  ctx: MutationCtx | QueryCtx,
  creatorId: string,
  now: number,
): Promise<{ workspace: number; creator: number }> {
  const scheduled = await ctx.db
    .query("scheduledCalls")
    .withIndex("by_status_starts", (q) => q.eq("status", "scheduled").gt("startsAt", now))
    .take(SCHEDULED_CALL_MAX_UPCOMING_WORKSPACE + 1);
  // Newest first: the cap is about upcoming calls, so reading the oldest
  // lifetime rows would always see zero once a creator passes the cap.
  const creator = await ctx.db
    .query("scheduledCalls")
    .withIndex("by_creator", (q) => q.eq("createdBy", creatorId))
    .order("desc")
    .take(SCHEDULED_CALL_MAX_UPCOMING_CREATOR + 1);
  return {
    workspace: scheduled.length,
    creator: creator.filter(
      (row) => row.startsAt > now && row.status !== "cancelled" && row.status !== "ended",
    ).length,
  };
}

/**
 * Per-viewer fields for the waiting room, additive on `list` and `get`:
 * `inviteOnly` (a standalone room always is), `invited` (may join without
 * asking, ignoring the clock) and `canManageWaiting` (may answer the waiting
 * room of a call that can still change).
 */
function viewerStanding(
  userId: string,
  permissions: bigint,
  scheduled: Doc<"scheduledCalls">,
  roleIds: readonly string[],
): { inviteOnly: boolean; invited: boolean; canManageWaiting: boolean } {
  const inviteOnly = isInviteOnly(scheduled);
  const live = scheduled.status === "scheduled" || scheduled.status === "open";
  return {
    inviteOnly,
    invited:
      !inviteOnly || isAdministrator(permissions) || isListedWithRoles(scheduled, userId, roleIds),
    canManageWaiting:
      live &&
      (isAdministrator(permissions) || mayManageScheduledCall(userId, permissions, scheduled)),
  };
}

/**
 * One viewer's scheduled calls in the bounded list window, newest start first.
 * Visibility is resolved server-side; an uninvited viewer never sees a room.
 */
export const list = query({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId, permissions } = await requireWorkspaceContext(
      ctx,
      Permission.ViewScheduledCalls,
    );
    const now = Date.now();
    const from = args.from ?? now - SCHEDULED_CALL_LIST_WINDOW_MS;
    const to = args.to ?? now + SCHEDULED_CALL_LIST_WINDOW_MS;
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), SCHEDULED_CALL_LIST_LIMIT);
    const context = await loadPermissionContext(ctx, userId);
    const administrator = isAdministrator(permissions);
    // Bounded scan of the selected window; the visible cap matches the limit.
    const rows = await ctx.db
      .query("scheduledCalls")
      .withIndex("by_starts", (q) => q.gte("startsAt", from).lte("startsAt", to))
      .order("desc")
      .take(SCHEDULED_CALL_LIST_LIMIT * 2);
    const visible: Array<{
      id: Id<"scheduledCalls">;
      title: string;
      description: string;
      startsAt: number;
      durationMinutes: number | null;
      openLeadMinutes: number;
      opensAt: number;
      channelId: Id<"channels"> | null;
      inviteeUserIds: readonly string[];
      inviteeRoleIds: readonly string[];
      createdBy: string;
      status: Doc<"scheduledCalls">["status"];
      callId: Id<"calls"> | null;
      canManage: boolean;
      canJoin: boolean;
      canJoinEarly: boolean;
      inviteOnly: boolean;
      invited: boolean;
      canManageWaiting: boolean;
    }> = [];
    const roleIds = await viewerRoleIds(ctx, userId);
    for (const scheduled of rows) {
      if (visible.length >= limit) {
        break;
      }
      if (scheduled.channelId !== undefined) {
        const channel = await ctx.db.get(scheduled.channelId);
        if (channel === null) continue;
        const channelContext = await scheduledCallPermissions(ctx, context, scheduled);
        if (!hasPermission(channelContext, Permission.ViewChannel)) continue;
      } else if (
        !isListedWithRoles(scheduled, userId, roleIds) &&
        !hasPermission(permissions, Permission.ManageScheduledCalls)
      ) {
        continue;
      }
      const content = await scheduledContent(scheduled);
      visible.push({
        id: scheduled._id,
        title: content.title,
        description: content.description,
        startsAt: scheduled.startsAt,
        durationMinutes: scheduled.durationMinutes ?? null,
        openLeadMinutes: scheduled.openLeadMinutes,
        opensAt: scheduledCallOpensAt(scheduled.startsAt, scheduled.openLeadMinutes),
        channelId: scheduled.channelId ?? null,
        inviteeUserIds: scheduled.inviteeUserIds,
        inviteeRoleIds: scheduled.inviteeRoleIds,
        createdBy: scheduled.createdBy,
        status: scheduled.status,
        callId: scheduled.callId ?? null,
        canManage: mayManageScheduledCall(userId, permissions, scheduled),
        canJoin: scheduled.status !== "cancelled" && scheduled.status !== "ended",
        canJoinEarly:
          administrator && scheduled.status !== "cancelled" && scheduled.status !== "ended",
        ...viewerStanding(userId, permissions, scheduled, roleIds),
      });
    }
    return visible;
  },
});

/** One scheduled call, including the viewer's join/manage capabilities. */
export const get = query({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId, permissions } = await requireWorkspaceContext(
      ctx,
      Permission.ViewScheduledCalls,
    );
    const scheduled = await findScheduledCall(ctx, args.scheduledCallId);
    if (scheduled === null) {
      throw new ConvexError("Scheduled call not found");
    }
    await requireScheduledCallVisible(ctx, userId, scheduled);
    const content = await scheduledContent(scheduled);
    return {
      id: scheduled._id,
      title: content.title,
      description: content.description,
      startsAt: scheduled.startsAt,
      durationMinutes: scheduled.durationMinutes ?? null,
      openLeadMinutes: scheduled.openLeadMinutes,
      opensAt: scheduledCallOpensAt(scheduled.startsAt, scheduled.openLeadMinutes),
      channelId: scheduled.channelId ?? null,
      inviteeUserIds: scheduled.inviteeUserIds,
      inviteeRoleIds: scheduled.inviteeRoleIds,
      createdBy: scheduled.createdBy,
      status: scheduled.status,
      callId: scheduled.callId ?? null,
      canManage: mayManageScheduledCall(userId, permissions, scheduled),
      canJoin: scheduled.status !== "cancelled" && scheduled.status !== "ended",
      canJoinEarly:
        isAdministrator(permissions) &&
        scheduled.status !== "cancelled" &&
        scheduled.status !== "ended",
      ...viewerStanding(userId, permissions, scheduled, await viewerRoleIds(ctx, userId)),
    };
  },
});

/** Creates a scheduled call. Needs `ScheduleCalls` (or `ManageScheduledCalls`). */
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startsAt: v.number(),
    durationMinutes: v.optional(v.number()),
    openLeadMinutes: v.optional(v.number()),
    channelId: v.optional(v.id("channels")),
    inviteeUserIds: v.optional(v.array(v.string())),
    inviteeRoleIds: v.optional(v.array(v.string())),
    inviteOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId, permissions } = await requireWorkspaceContext(ctx);
    if (
      !hasPermission(permissions, Permission.ScheduleCalls) &&
      !hasPermission(permissions, Permission.ManageScheduledCalls)
    ) {
      throw new ConvexError("Missing scheduled-call permission");
    }
    await assertMayParticipate(ctx, userId);
    const now = Date.now();
    const title = validateText(args.title, "Title", SCHEDULED_CALL_TITLE_MAX);
    const description =
      args.description === undefined
        ? ""
        : validateText(args.description, "Description", SCHEDULED_CALL_DESCRIPTION_MAX, false);
    validateTimes(args.startsAt, args.durationMinutes, now);
    const openLeadMinutes = clampOpenLeadMinutes(args.openLeadMinutes ?? 5);
    if ((args.inviteeUserIds ?? []).length > 200 || (args.inviteeRoleIds ?? []).length > 50) {
      throw new ConvexError("Too many invitees");
    }
    if (args.channelId !== undefined) {
      await requireChannelAccessForUser(ctx, userId, args.channelId, Permission.Connect);
      const channel = await ctx.db.get(args.channelId);
      if (channel === null) {
        throw new ConvexError("Channel not found");
      }
      assertCallableKind(channel.kind);
    } else if (
      (args.inviteeUserIds ?? []).length === 0 &&
      (args.inviteeRoleIds ?? []).length === 0
    ) {
      throw new ConvexError("Invite at least one person or role for a standalone call");
    }
    // Invitees apply to a standalone room, and to a channel call only when it
    // is invite-only; an empty list there means just the creator and
    // administrators (and anyone a host admits) can get in.
    const inviteOnly = args.channelId !== undefined && args.inviteOnly === true;
    const keepInvitees = args.channelId === undefined || inviteOnly;
    const inviteeUserIds = keepInvitees ? [...(args.inviteeUserIds ?? [])] : [];
    const inviteeRoleIds = keepInvitees ? [...(args.inviteeRoleIds ?? [])] : [];
    await validateInvitees(ctx, inviteeUserIds, inviteeRoleIds);
    const counts = await upcomingCounts(ctx, userId, now);
    if (counts.workspace >= SCHEDULED_CALL_MAX_UPCOMING_WORKSPACE) {
      throw new ConvexError(
        `This workspace has reached its ${SCHEDULED_CALL_MAX_UPCOMING_WORKSPACE}-call limit`,
      );
    }
    if (counts.creator >= SCHEDULED_CALL_MAX_UPCOMING_CREATOR) {
      throw new ConvexError(
        `You have reached your ${SCHEDULED_CALL_MAX_UPCOMING_CREATOR}-call limit`,
      );
    }
    const id = await ctx.db.insert("scheduledCalls", {
      titleCiphertext: "",
      ...(description.length > 0 ? { descriptionCiphertext: "" } : {}),
      startsAt: Math.trunc(args.startsAt),
      ...(args.durationMinutes !== undefined
        ? { durationMinutes: Math.trunc(args.durationMinutes) }
        : {}),
      openLeadMinutes,
      ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
      inviteeUserIds,
      inviteeRoleIds,
      ...(inviteOnly ? { inviteOnly: true } : {}),
      createdBy: userId,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    const sealed = {
      titleCiphertext: await sealString({ scope: "scheduledCall", recordId: id }, title),
      ...(description.length > 0
        ? {
            descriptionCiphertext: await sealString(
              { scope: "scheduledCall", recordId: id },
              description,
            ),
          }
        : {}),
    };
    await ctx.db.patch(id, sealed);
    await armOpenJob(ctx, id, scheduledCallOpensAt(args.startsAt, openLeadMinutes));
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.create",
      targetId: id,
      meta: JSON.stringify({ startsAt: args.startsAt, openLeadMinutes }),
    });
    return id;
  },
});

async function validateInvitees(
  ctx: MutationCtx,
  userIds: readonly string[],
  roleIds: readonly string[],
): Promise<void> {
  for (const invitee of [...new Set(userIds)]) {
    // Bots hold a member row but are not people a call can invite.
    if (isBotUserId(invitee)) {
      throw new ConvexError("Bots cannot be invited to a call");
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", invitee))
      .unique();
    if (member === null) {
      throw new ConvexError("One of the invitees is not a member");
    }
  }
  if (roleIds.length > 0) {
    const roles = await ctx.db.query("roles").take(200);
    const defined = new Set(roles.map((role) => role.key ?? role._id));
    for (const roleId of [...new Set(roleIds)]) {
      if (!defined.has(roleId)) {
        throw new ConvexError("One of the invited roles does not exist");
      }
    }
  }
}

/** Scheduling job that flips a call to `open` at its open time. */
async function armOpenJob(
  ctx: MutationCtx,
  scheduledCallId: Id<"scheduledCalls">,
  opensAt: number,
  now: number = Date.now(),
): Promise<void> {
  const scheduled = await ctx.db.get(scheduledCallId);
  if (scheduled !== null && scheduled.openJobId !== undefined) {
    try {
      await ctx.scheduler.cancel(scheduled.openJobId);
    } catch {
      // Already fired; the handler re-validates.
    }
  }
  const jobId = await ctx.scheduler.runAfter(
    Math.max(0, opensAt - now),
    internal.scheduledCalls.openOne,
    { scheduledCallId },
  );
  await ctx.db.patch(scheduledCallId, { openJobId: jobId });
}

/** Edits a scheduled call. Needs ownership + `ScheduleCalls`, or `ManageScheduledCalls`. */
export const update = mutation({
  args: {
    scheduledCallId: v.id("scheduledCalls"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    openLeadMinutes: v.optional(v.number()),
    inviteeUserIds: v.optional(v.array(v.string())),
    inviteeRoleIds: v.optional(v.array(v.string())),
    inviteOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId, permissions } = await requireWorkspaceContext(ctx);
    const scheduled = await findScheduledCall(ctx, args.scheduledCallId);
    if (scheduled === null) {
      throw new ConvexError("Scheduled call not found");
    }
    if (!mayManageScheduledCall(userId, permissions, scheduled)) {
      throw new ConvexError("You cannot edit this scheduled call");
    }
    if (scheduled.status !== "scheduled" && scheduled.status !== "open") {
      throw new ConvexError("This call has ended or was cancelled and can no longer be edited");
    }
    await assertMayParticipate(ctx, userId);
    const now = Date.now();
    const startsAt = args.startsAt === undefined ? scheduled.startsAt : Math.trunc(args.startsAt);
    const durationMinutes =
      args.durationMinutes === undefined
        ? scheduled.durationMinutes
        : Math.trunc(args.durationMinutes);
    // Only a real change is checked against the clock, so renaming a call that
    // has already started does not trip the "start must be in the future" rule.
    if (startsAt !== scheduled.startsAt) {
      validateStart(startsAt, now);
    }
    if (args.durationMinutes !== undefined && durationMinutes !== scheduled.durationMinutes) {
      validateDuration(durationMinutes);
    }
    const openLeadMinutes =
      args.openLeadMinutes === undefined
        ? scheduled.openLeadMinutes
        : clampOpenLeadMinutes(args.openLeadMinutes);
    const patch: Record<string, unknown> = {
      startsAt,
      openLeadMinutes,
      updatedAt: now,
    };
    if (args.durationMinutes !== undefined) {
      patch.durationMinutes = durationMinutes;
    }
    if (args.title !== undefined) {
      const title = validateText(args.title, "Title", SCHEDULED_CALL_TITLE_MAX);
      patch.titleCiphertext = await sealString(
        { scope: "scheduledCall", recordId: scheduled._id },
        title,
      );
    }
    if (args.description !== undefined) {
      const description = validateText(
        args.description,
        "Description",
        SCHEDULED_CALL_DESCRIPTION_MAX,
        false,
      );
      patch.descriptionCiphertext =
        description.length === 0
          ? undefined
          : await sealString({ scope: "scheduledCall", recordId: scheduled._id }, description);
    }
    // A standalone room is always invite-only. A channel call is only while
    // `inviteOnly` is on; turning it off drops the list. An older client that
    // omits the field keeps the stored value.
    const channelBound = scheduled.channelId !== undefined;
    const inviteOnly = channelBound ? (args.inviteOnly ?? scheduled.inviteOnly === true) : true;
    if (channelBound && args.inviteOnly !== undefined) {
      patch.inviteOnly = args.inviteOnly ? true : undefined;
    }
    if (channelBound && !inviteOnly) {
      if (scheduled.inviteeUserIds.length > 0 || scheduled.inviteeRoleIds.length > 0) {
        patch.inviteeUserIds = [];
        patch.inviteeRoleIds = [];
      }
    } else if (args.inviteeUserIds !== undefined || args.inviteeRoleIds !== undefined) {
      const userIds = args.inviteeUserIds ?? scheduled.inviteeUserIds;
      const roleIds = args.inviteeRoleIds ?? scheduled.inviteeRoleIds;
      if (userIds.length > 200 || roleIds.length > 50) {
        throw new ConvexError("Too many invitees");
      }
      await validateInvitees(ctx, userIds, roleIds);
      patch.inviteeUserIds = [...userIds];
      patch.inviteeRoleIds = [...roleIds];
    }
    // An open call with a live room stays open and live whatever its new time.
    // An open call with no room that is moved into the future goes back to
    // scheduled so it opens at the new time.
    const room = scheduled.callId === undefined ? null : await ctx.db.get(scheduled.callId);
    const liveRoom = room !== null && room.status !== "ended" ? room : null;
    const opensAt = scheduledCallOpensAt(startsAt, openLeadMinutes);
    let rearm = scheduled.status === "scheduled";
    if (scheduled.status === "open" && liveRoom === null && opensAt > now) {
      patch.status = "scheduled";
      patch.callId = undefined;
      rearm = true;
    }
    await ctx.db.patch(scheduled._id, patch);
    if (rearm) {
      await armOpenJob(ctx, scheduled._id, opensAt, now);
    }
    if (liveRoom !== null) {
      // A new window can start or end the solo-call exemption for the room.
      await syncAloneTimerForCall(ctx, liveRoom._id);
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.update",
      targetId: scheduled._id,
      meta: JSON.stringify({
        changed: Object.keys(args).filter((key) => key !== "scheduledCallId"),
      }),
    });
    return null;
  },
});

/** Cancels a scheduled call and ends its live room, if one exists. */
export const cancel = mutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId, permissions } = await requireWorkspaceContext(ctx);
    const scheduled = await findScheduledCall(ctx, args.scheduledCallId);
    if (scheduled === null) {
      throw new ConvexError("Scheduled call not found");
    }
    if (!mayManageScheduledCall(userId, permissions, scheduled)) {
      throw new ConvexError("You cannot cancel this scheduled call");
    }
    await assertMayParticipate(ctx, userId);
    if (scheduled.status === "cancelled" || scheduled.status === "ended") {
      return null;
    }
    if (scheduled.openJobId !== undefined) {
      try {
        await ctx.scheduler.cancel(scheduled.openJobId);
      } catch {
        // Already fired.
      }
    }
    if (scheduled.callId !== undefined) {
      const call = await ctx.db.get(scheduled.callId);
      if (call !== null && call.status !== "ended") {
        await endCall(ctx, call);
      }
    }
    await ctx.db.patch(scheduled._id, {
      status: "cancelled",
      cancelledAt: Date.now(),
      openJobId: undefined,
      updatedAt: Date.now(),
    });
    await purgeWaiting(ctx, scheduled._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.cancel",
      targetId: scheduled._id,
    });
    return null;
  },
});

/**
 * Joins a scheduled call, creating its room on the first join. Throws the typed
 * `ScheduledCallNotOpen` error before the open window and for cancelled/ended
 * calls.
 */
export const join = mutation({
  args: { scheduledCallId: v.id("scheduledCalls"), clientId: v.string() },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const scheduled = await findScheduledCall(ctx, args.scheduledCallId);
    if (scheduled === null) {
      throw new ConvexError("Scheduled call not found");
    }
    if (scheduled.status === "cancelled" || scheduled.status === "ended") {
      throw new ConvexError("This scheduled call has ended");
    }
    if (scheduled.channelId !== undefined) {
      const channel = await ctx.db.get(scheduled.channelId);
      if (channel === null) {
        throw new ConvexError("Channel not found");
      }
      assertCallableKind(channel.kind);
    }
    const { early } = await assertScheduledCallOpenForUser(ctx, userId, scheduled);
    await requireScheduledCallJoinable(ctx, userId, scheduled);
    await assertMayParticipate(ctx, userId);
    const policy = await loadVoicePolicyForScheduled(ctx);
    if (!policy.enabled) {
      throw new ConvexError("Voice and video calls are disabled in this workspace");
    }
    const match = await resolveScheduledLiveCall(ctx, scheduled);
    if (match.blockedBy !== null) {
      // The only live room on this channel belongs to another scheduled
      // meeting. Never reuse it; a shared room would mix meetings.
      throw new ConvexError("This call belongs to another scheduled meeting");
    }
    const live = match.call;
    if (live !== null) {
      // Reusing an unassociated channel room claims it for this meeting in the
      // same mutation, so another meeting's guest admission cannot take it.
      if (live.scheduledCallId === undefined) {
        await claimChannelRoomForScheduled(ctx, live, scheduled);
      }
      const { seat, leftCallIds } = await prepareSeat(ctx, {
        userId,
        clientId: assertClientId(args.clientId),
        takeover: false,
        call: live,
        maxParticipants: policy.maxParticipants,
      });
      // Switching out of another call can leave it solo; sync it now rather
      // than waiting for the sweep.
      for (const leftCallId of leftCallIds) {
        await syncAloneTimerForCall(ctx, leftCallId);
      }
      if (seat === "absent") {
        await ctx.db.insert("callParticipants", {
          callId: live._id,
          ...(live.channelId !== undefined ? { channelId: live.channelId } : {}),
          userId,
          guestKey: randomToken(16),
          clientId: assertClientId(args.clientId),
          session: 1,
          muted: false,
          deafened: false,
          video: false,
          sharingScreen: false,
          joinedAt: Date.now(),
          lastSeen: Date.now(),
        });
      }
      if (live.status === "ringing") {
        await ctx.db.patch(live._id, {
          status: "active",
          ringingUserIds: [],
          updatedAt: Date.now(),
        });
      }
      // A second invitee clears the solo deadline; the first keep the window.
      await syncAloneTimerForCall(ctx, live._id);
      // `openOne` usually already moved the row to `open`, so persist the room
      // association regardless of status.
      await ctx.db.patch(scheduled._id, {
        // An early administrator join must not open the call for everyone;
        // `openOne` flips it at the normal time.
        ...(scheduled.status === "scheduled" && !early ? { status: "open" as const } : {}),
        callId: live._id,
        updatedAt: Date.now(),
      });
      await consumeWaitingRow(ctx, scheduled._id, userId);
      return { callId: live._id, created: false, scheduledCallId: scheduled._id };
    }
    const { callId } = await insertScheduledCall(
      ctx,
      scheduled,
      userId,
      args.clientId,
      policy.maxParticipants,
    );
    await ctx.db.patch(
      scheduled._id,
      early
        ? { callId, updatedAt: Date.now() }
        : { status: "open", callId, openJobId: undefined, updatedAt: Date.now() },
    );
    await consumeWaitingRow(ctx, scheduled._id, userId);
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.open",
      targetId: scheduled._id,
      meta: JSON.stringify(early ? { callId, early: true } : { callId }),
    });
    return { callId, created: true, scheduledCallId: scheduled._id };
  },
});

async function loadVoicePolicyForScheduled(ctx: MutationCtx) {
  const server = await ctx.db.query("server").first();
  return {
    enabled: server?.settings.voiceEnabled ?? true,
    maxParticipants: server?.settings.maxCallParticipants ?? 10,
  };
}

async function insertScheduledCall(
  ctx: MutationCtx,
  scheduled: Doc<"scheduledCalls">,
  userId: string,
  clientId: string,
  maxParticipants: number,
): Promise<{ callId: Id<"calls"> }> {
  const now = Date.now();
  const callId = await ctx.db.insert("calls", {
    ...(scheduled.channelId !== undefined ? { channelId: scheduled.channelId } : {}),
    scheduledCallId: scheduled._id,
    kind: "voice",
    initiatorId: userId,
    status: "active",
    ringingUserIds: [],
    startedAt: now,
    updatedAt: now,
  });
  const call = await ctx.db.get(callId);
  if (call === null) {
    throw new ConvexError("Could not create the call");
  }
  // The first join goes through the same seat rules as every other call: one
  // seat per user, one device for that seat, and cleanup of the previous call.
  const { seat, leftCallIds } = await prepareSeat(ctx, {
    userId,
    clientId: assertClientId(clientId),
    takeover: false,
    call,
    maxParticipants,
  });
  // Switching out of another call can leave it with one participant; arm its
  // solo window now instead of waiting for the 30 s sweep.
  for (const leftCallId of leftCallIds) {
    await syncAloneTimerForCall(ctx, leftCallId);
  }
  if (seat === "absent") {
    await insertParticipant(ctx, callId, scheduled.channelId, userId, clientId);
  }
  await syncAloneTimerForCall(ctx, callId);
  return { callId };
}

/** Flips one scheduled call to `open` at its open time. */
export const openOne = internalMutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    const scheduled = await ctx.db.get(args.scheduledCallId);
    if (scheduled === null || scheduled.status !== "scheduled") {
      return null;
    }
    if (Date.now() < scheduledCallOpensAt(scheduled.startsAt, scheduled.openLeadMinutes)) {
      return null;
    }
    await ctx.db.patch(scheduled._id, {
      status: "open",
      openJobId: undefined,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: scheduled.createdBy,
      action: "scheduledCall.openDue",
      targetId: scheduled._id,
    });
    return null;
  },
});

/**
 * Backstop for a lost open job and for calls whose window has passed. Runs on
 * a cron; reads bounded batches through `by_status_starts`.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("scheduledCalls")
      .withIndex("by_status_starts", (q) =>
        q
          .eq("status", "scheduled")
          .lte("startsAt", now + SCHEDULED_CALL_MAX_OPEN_LEAD_MINUTES * 60_000),
      )
      .take(100);
    for (const scheduled of due) {
      if (now < scheduledCallOpensAt(scheduled.startsAt, scheduled.openLeadMinutes)) {
        continue;
      }
      await ctx.db.patch(scheduled._id, {
        status: "open",
        openJobId: undefined,
        updatedAt: now,
      });
    }
    const open = await ctx.db
      .query("scheduledCalls")
      .withIndex("by_status_starts", (q) => q.eq("status", "open").lt("startsAt", now))
      .take(100);
    for (const scheduled of open) {
      const endAt = scheduledCallEndsAt(scheduled.startsAt, scheduled.durationMinutes);
      if (now < endAt) {
        continue;
      }
      if (scheduled.callId !== undefined) {
        const call = await ctx.db.get(scheduled.callId);
        if (call !== null && call.status !== "ended") {
          await endCall(ctx, call);
        }
      }
      await ctx.db.patch(scheduled._id, {
        status: "ended",
        endedAt: now,
        updatedAt: now,
      });
      await purgeWaiting(ctx, scheduled._id);
    }
    // Lapsed waiting-room rows (unanswered knocks, early arrivals who never
    // came, cooled-down declines) go in bounded batches.
    const lapsed = await ctx.db
      .query("scheduledCallWaiting")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(WAITING_PRUNE_BATCH);
    for (const row of lapsed) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/** Lapsed waiting-room rows removed per sweep run. */
const WAITING_PRUNE_BATCH = 100;
/** Entering the waiting room: 20 per minute per member. */
const WAITING_ENTER_RATE_LIMIT = 20;
const WAITING_ENTER_RATE_WINDOW_MS = 60_000;

/**
 * Deletes a call's waiting-room rows in a bounded batch and continues in the
 * background when the batch was full. Used when the call ends or is cancelled.
 */
async function purgeWaiting(
  ctx: MutationCtx,
  scheduledCallId: Id<"scheduledCalls">,
): Promise<void> {
  if (await deleteWaitingRows(ctx, scheduledCallId)) {
    await ctx.scheduler.runAfter(0, internal.scheduledCalls.purgeWaitingRows, { scheduledCallId });
  }
}

/** Continuation of {@link purgeWaiting} for a call with many rows. */
export const purgeWaitingRows = internalMutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    await purgeWaiting(ctx, args.scheduledCallId);
    return null;
  },
});

export type WaitingEnterResult =
  | { readonly state: "join" }
  | { readonly state: "waiting"; readonly kind: ScheduledWaitingKind; readonly expiresAt: number }
  | { readonly state: "declined"; readonly retryAt: number };

/**
 * Asks to get into a scheduled call that the caller cannot join yet.
 *
 * - If they can join right now the answer is `join` and nothing is stored; the
 *   client joins directly.
 * - A member who is allowed in but early waits as `early` and is let in
 *   automatically when the call opens (the client then calls `join`), or
 *   sooner when a host lets them in.
 * - A member who is not on the list of an invite-only call knocks and needs a
 *   host to admit them.
 * - A declined member cannot ask again for a short cooldown.
 */
export const enter = mutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args): Promise<WaitingEnterResult> => {
    await requireAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const scheduled = await findScheduledCall(ctx, args.scheduledCallId);
    if (scheduled === null) {
      throw new ConvexError("Scheduled call not found");
    }
    if (scheduled.status === "cancelled" || scheduled.status === "ended") {
      throw new ConvexError("This scheduled call has ended");
    }
    await requireScheduledCallVisible(ctx, userId, scheduled);
    const workspace = await requireScheduledCallConnect(ctx, userId, scheduled);
    await assertMayParticipate(ctx, userId);
    const now = Date.now();
    const standing = await scheduledCallStanding(ctx, userId, scheduled, workspace, now);
    const opensAt = scheduledCallOpensAt(scheduled.startsAt, scheduled.openLeadMinutes);
    const windowOpen = scheduled.status === "open" || now >= opensAt;
    if (standing.allowed && (windowOpen || standing.administrator || standing.admitted)) {
      return { state: "join" };
    }
    const existing = await findWaitingRow(ctx, scheduled._id, userId);
    if (existing !== null && existing.status === "declined" && existing.expiresAt > now) {
      return { state: "declined", retryAt: existing.expiresAt };
    }
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("scheduled-waiting", userId),
      limit: WAITING_ENTER_RATE_LIMIT,
      windowMs: WAITING_ENTER_RATE_WINDOW_MS,
    });
    const kind: ScheduledWaitingKind = standing.allowed ? "early" : "knock";
    const expiresAt =
      kind === "early"
        ? Math.min(opensAt + SCHEDULED_WAITING_GRACE_MS, now + SCHEDULED_WAITING_EARLY_MAX_MS)
        : now + SCHEDULED_WAITING_KNOCK_TTL_MS;
    if (existing !== null && existing.status === "waiting" && existing.expiresAt > now) {
      await ctx.db.patch(existing._id, { kind, expiresAt, updatedAt: now });
      return { state: "waiting", kind, expiresAt };
    }
    const pending = await livePendingRows(ctx, scheduled._id, now);
    if (pending.length >= SCHEDULED_WAITING_MAX_PENDING) {
      throw new ConvexError("Too many people are waiting to join. Try again in a moment.");
    }
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        kind,
        status: "waiting",
        requestedAt: now,
        updatedAt: now,
        expiresAt,
        decidedBy: undefined,
        decidedAt: undefined,
      });
    } else {
      await ctx.db.insert("scheduledCallWaiting", {
        scheduledCallId: scheduled._id,
        userId,
        kind,
        status: "waiting",
        requestedAt: now,
        updatedAt: now,
        expiresAt,
      });
    }
    return { state: "waiting", kind, expiresAt };
  },
});

/**
 * The call's unexpired `waiting` rows, oldest first. Reads at most twice the
 * cap, which always covers the live rows because `enter` refuses past the cap.
 */
async function livePendingRows(
  ctx: MutationCtx | QueryCtx,
  scheduledCallId: Id<"scheduledCalls">,
  now: number,
): Promise<Doc<"scheduledCallWaiting">[]> {
  const rows = await ctx.db
    .query("scheduledCallWaiting")
    .withIndex("by_call_status", (q) =>
      q.eq("scheduledCallId", scheduledCallId).eq("status", "waiting"),
    )
    .take(SCHEDULED_WAITING_MAX_PENDING * 2);
  return rows.filter((row) => row.expiresAt > now);
}

/** Withdraws the caller's own request (or admission) for a call. */
export const leave = mutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const row = await findWaitingRow(ctx, args.scheduledCallId, userId);
    if (row !== null) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/**
 * The caller's own waiting-room state across calls, so the app shell can show it
 * and join automatically. Bounded to a handful of rows per member.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    await requireAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("scheduledCallWaiting")
      .withIndex("by_user_expires", (q) => q.eq("userId", userId).gt("expiresAt", now))
      .take(MINE_LIMIT);
    const views: Array<{
      id: Id<"scheduledCallWaiting">;
      scheduledCallId: Id<"scheduledCalls">;
      title: string;
      kind: ScheduledWaitingKind;
      state: Doc<"scheduledCallWaiting">["status"];
      callStatus: Doc<"scheduledCalls">["status"];
      opensAt: number;
      startsAt: number;
      expiresAt: number;
    }> = [];
    for (const row of rows) {
      const scheduled = await ctx.db.get(row.scheduledCallId);
      if (scheduled === null || scheduled.status === "cancelled" || scheduled.status === "ended") {
        continue;
      }
      views.push({
        id: row._id,
        scheduledCallId: scheduled._id,
        title: (await scheduledContent(scheduled)).title,
        kind: row.kind,
        state: row.status,
        callStatus: scheduled.status,
        opensAt: scheduledCallOpensAt(scheduled.startsAt, scheduled.openLeadMinutes),
        startsAt: scheduled.startsAt,
        expiresAt: row.expiresAt,
      });
    }
    return views;
  },
});

/** Waiting-room rows one member can hold across calls. */
const MINE_LIMIT = 10;

async function loadManagedCall(
  ctx: MutationCtx | QueryCtx,
  scheduledCallId: Id<"scheduledCalls">,
): Promise<{ scheduled: Doc<"scheduledCalls">; userId: string }> {
  const { userId, permissions } = await requireWorkspaceContext(ctx);
  const scheduled = await findScheduledCall(ctx, scheduledCallId);
  if (scheduled === null) {
    throw new ConvexError("Scheduled call not found");
  }
  if (!isAdministrator(permissions) && !mayManageScheduledCall(userId, permissions, scheduled)) {
    throw new ConvexError("You cannot manage who joins this call");
  }
  return { scheduled, userId };
}

/**
 * Whether the caller may answer a call's waiting room. The UI subscribes to the
 * list only when this is true; it never throws for a missing permission.
 */
export const waitingAccess = query({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server?.settings.scheduledCallsEnabled !== true) {
      return { canManage: false };
    }
    const { userId, permissions } = await requireWorkspaceContext(ctx);
    const scheduled = await findScheduledCall(ctx, args.scheduledCallId);
    if (scheduled === null || (scheduled.status !== "scheduled" && scheduled.status !== "open")) {
      return { canManage: false };
    }
    return {
      canManage:
        isAdministrator(permissions) || mayManageScheduledCall(userId, permissions, scheduled),
    };
  },
});

/** The people waiting for a call, with names, for the hosts who may answer. */
export const waitingList = query({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { scheduled } = await loadManagedCall(ctx, args.scheduledCallId);
    const now = Date.now();
    const rows = (await livePendingRows(ctx, scheduled._id, now)).slice(
      0,
      SCHEDULED_WAITING_MAX_PENDING,
    );
    const names = await accountNames(
      ctx,
      rows.map((row) => row.userId),
    );
    const waiting = [];
    for (const row of rows) {
      const member = await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", row.userId))
        .unique();
      const nickname = member?.nickname?.trim();
      waiting.push({
        id: row._id,
        userId: row.userId,
        displayName:
          nickname !== undefined && nickname.length > 0
            ? nickname
            : (names.get(row.userId) ?? "Member"),
        kind: row.kind,
        requestedAt: row.requestedAt,
        expiresAt: row.expiresAt,
      });
    }
    return { waiting };
  },
});

async function admitRow(
  ctx: MutationCtx,
  scheduled: Doc<"scheduledCalls">,
  row: Doc<"scheduledCallWaiting">,
  actorId: string,
  now: number,
): Promise<void> {
  await ctx.db.patch(row._id, {
    status: "admitted",
    decidedBy: actorId,
    decidedAt: now,
    updatedAt: now,
    // The admission outlives the join so a rejoin after a disconnect works for
    // the whole window; the call ending deletes it sooner.
    expiresAt:
      Math.max(scheduledCallEndsAt(scheduled.startsAt, scheduled.durationMinutes), now) +
      SCHEDULED_WAITING_GRACE_MS,
  });
}

async function assertAdmissionRoom(
  ctx: MutationCtx,
  scheduled: Doc<"scheduledCalls">,
  adding: number,
): Promise<void> {
  const admitted = await ctx.db
    .query("scheduledCallWaiting")
    .withIndex("by_call_status", (q) =>
      q.eq("scheduledCallId", scheduled._id).eq("status", "admitted"),
    )
    .take(SCHEDULED_WAITING_MAX_ADMITTED + 1);
  if (admitted.length + adding > SCHEDULED_WAITING_MAX_ADMITTED) {
    throw new ConvexError("This call has already let in the maximum number of people");
  }
}

async function loadPendingRow(
  ctx: MutationCtx,
  waitingId: Id<"scheduledCallWaiting">,
): Promise<Doc<"scheduledCallWaiting">> {
  const row = await ctx.db.get(waitingId);
  if (row === null || row.status !== "waiting" || row.expiresAt <= Date.now()) {
    throw new ConvexError("This request is no longer waiting");
  }
  return row;
}

/** Lets one waiting member in: an early arrival now, or a knocker past the list. */
export const admit = mutation({
  args: { waitingId: v.id("scheduledCallWaiting") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const row = await loadPendingRow(ctx, args.waitingId);
    const { scheduled, userId } = await loadManagedCall(ctx, row.scheduledCallId);
    if (scheduled.status !== "scheduled" && scheduled.status !== "open") {
      throw new ConvexError("This scheduled call has ended");
    }
    await assertMayParticipate(ctx, userId);
    await assertAdmissionRoom(ctx, scheduled, 1);
    await admitRow(ctx, scheduled, row, userId, Date.now());
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.waitingAdmit",
      targetId: scheduled._id,
      meta: JSON.stringify({ member: row.userId, kind: row.kind }),
    });
    return null;
  },
});

/** Turns a waiting member away. They cannot ask again for a short while. */
export const decline = mutation({
  args: { waitingId: v.id("scheduledCallWaiting") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const row = await loadPendingRow(ctx, args.waitingId);
    const { scheduled, userId } = await loadManagedCall(ctx, row.scheduledCallId);
    await assertMayParticipate(ctx, userId);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "declined",
      decidedBy: userId,
      decidedAt: now,
      updatedAt: now,
      expiresAt: now + SCHEDULED_WAITING_DECLINE_COOLDOWN_MS,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.waitingDecline",
      targetId: scheduled._id,
      meta: JSON.stringify({ member: row.userId, kind: row.kind }),
    });
    return null;
  },
});

/** Lets every waiting early arrival in at once. Knockers still need an answer each. */
export const admitAllEarly = mutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    await requireAddon(ctx);
    const { scheduled, userId } = await loadManagedCall(ctx, args.scheduledCallId);
    if (scheduled.status !== "scheduled" && scheduled.status !== "open") {
      throw new ConvexError("This scheduled call has ended");
    }
    await assertMayParticipate(ctx, userId);
    const now = Date.now();
    const early = (await livePendingRows(ctx, scheduled._id, now)).filter(
      (row) => row.kind === "early",
    );
    if (early.length === 0) {
      return 0;
    }
    await assertAdmissionRoom(ctx, scheduled, early.length);
    for (const row of early) {
      await admitRow(ctx, scheduled, row, userId, now);
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.waitingAdmitAll",
      targetId: scheduled._id,
      meta: JSON.stringify({ count: early.length }),
    });
    return early.length;
  },
});
