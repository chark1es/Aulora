import {
  clampOpenLeadMinutes,
  hasPermission,
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
import {
  assertScheduledCallOpen,
  findScheduledCall,
  isStandaloneInvitee,
  mayManageScheduledCall,
  requireScheduledCallJoinable,
  requireScheduledCallVisible,
  resolveScheduledLiveCall,
  scheduledCallPermissions,
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

function validateTimes(startsAt: number, durationMinutes: number | undefined, now: number): void {
  if (!Number.isFinite(startsAt)) {
    throw new ConvexError("Start time is invalid");
  }
  if (startsAt < now - SCHEDULED_CALL_START_TOLERANCE_MS) {
    throw new ConvexError("Start time must be in the future");
  }
  if (startsAt > now + SCHEDULED_CALL_MAX_HORIZON_MS) {
    throw new ConvexError("Start time must be within the next year");
  }
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
    }> = [];
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
        !(await isStandaloneInvitee(ctx, scheduled, userId)) &&
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
    await validateInvitees(ctx, args.inviteeUserIds ?? [], args.inviteeRoleIds ?? []);
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
      inviteeUserIds: args.channelId === undefined ? [...(args.inviteeUserIds ?? [])] : [],
      inviteeRoleIds: args.channelId === undefined ? [...(args.inviteeRoleIds ?? [])] : [],
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
    if (scheduled.status !== "scheduled") {
      throw new ConvexError("Only a call that has not opened can be edited");
    }
    await assertMayParticipate(ctx, userId);
    const now = Date.now();
    const startsAt = args.startsAt ?? scheduled.startsAt;
    const durationMinutes = args.durationMinutes ?? scheduled.durationMinutes;
    validateTimes(startsAt, durationMinutes, now);
    const openLeadMinutes =
      args.openLeadMinutes === undefined
        ? scheduled.openLeadMinutes
        : clampOpenLeadMinutes(args.openLeadMinutes);
    const patch: Record<string, unknown> = {
      startsAt: Math.trunc(startsAt),
      openLeadMinutes,
      updatedAt: now,
    };
    if (args.durationMinutes !== undefined) {
      patch.durationMinutes = Math.trunc(args.durationMinutes);
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
    if (args.inviteeUserIds !== undefined || args.inviteeRoleIds !== undefined) {
      const userIds = args.inviteeUserIds ?? scheduled.inviteeUserIds;
      const roleIds = args.inviteeRoleIds ?? scheduled.inviteeRoleIds;
      await validateInvitees(ctx, userIds, roleIds);
      patch.inviteeUserIds = [...userIds];
      patch.inviteeRoleIds = [...roleIds];
    }
    await ctx.db.patch(scheduled._id, patch);
    await armOpenJob(ctx, scheduled._id, scheduledCallOpensAt(startsAt, openLeadMinutes), now);
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
    assertScheduledCallOpen(scheduled);
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
        await ctx.db.patch(live._id, {
          scheduledCallId: scheduled._id,
          updatedAt: Date.now(),
        });
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
        ...(scheduled.status === "scheduled" ? { status: "open" as const } : {}),
        callId: live._id,
        updatedAt: Date.now(),
      });
      return { callId: live._id, created: false, scheduledCallId: scheduled._id };
    }
    const { callId } = await insertScheduledCall(
      ctx,
      scheduled,
      userId,
      args.clientId,
      policy.maxParticipants,
    );
    await ctx.db.patch(scheduled._id, {
      status: "open",
      callId,
      openJobId: undefined,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "scheduledCall.open",
      targetId: scheduled._id,
      meta: JSON.stringify({ callId }),
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
      const endAt = scheduled.startsAt + (scheduled.durationMinutes ?? 240) * 60_000;
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
    }
    return null;
  },
});

/** Internal watchdog used by tests; not part of the public surface. */
export const endScheduled = internalMutation({
  args: { scheduledCallId: v.id("scheduledCalls") },
  handler: async (ctx, args) => {
    const scheduled = await ctx.db.get(args.scheduledCallId);
    if (scheduled === null) {
      return null;
    }
    if (scheduled.callId !== undefined) {
      const call = await ctx.db.get(scheduled.callId);
      if (call !== null && call.status !== "ended") {
        await endCall(ctx, call);
      }
    }
    await ctx.db.patch(scheduled._id, {
      status: "ended",
      endedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});
