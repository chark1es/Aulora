import { hasPermission, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import {
  assertCallableKind,
  assertClientId,
  CALL_RETENTION_MS,
  type CallSummary,
  endCall,
  findLiveCall,
  findParticipant,
  finishIfEmpty,
  heldByOtherDevice,
  insertNewCall,
  insertParticipant,
  loadVoicePolicy,
  MAX_SIGNAL_BYTES,
  PARTICIPANT_STALE_MS,
  prepareSeat,
  RING_TIMEOUT_MS,
  removeParticipant,
  reuseLiveCall,
  SIGNAL_STALE_MS,
  toCallSummary,
} from "./lib/calls";
import { isDmKind, requireChannelAccess } from "./lib/channels";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./lib/permissions";

/**
 * Voice/video call state and WebRTC signalling.
 *
 * The backend is deliberately media-free: it stores who is in a call, their
 * mute/video/screen flags, and short-lived SDP/ICE envelopes addressed between
 * participants. The audio and video themselves travel peer-to-peer (a mesh),
 * which keeps the self-hosted deployment free of an SFU/TURN dependency and
 * gives the lowest possible latency for small calls.
 *
 * Rows mirror the `presence`/`typing` pattern: short-lived, heart-beaten, and
 * swept by a cron so a crashed client cannot strand a call.
 */

export { isCallMember } from "./lib/calls";
export { CALL_RETENTION_MS, PARTICIPANT_STALE_MS, RING_TIMEOUT_MS, SIGNAL_STALE_MS };

/**
 * Starts (or reuses) the call on a channel. A DM/group-DM call begins ringing;
 * a voice-channel call is active immediately and others join when they want.
 */
export const start = mutation({
  args: {
    channelId: v.id("channels"),
    kind: v.union(v.literal("voice"), v.literal("video")),
    ringingUserIds: v.optional(v.array(v.string())),
    clientId: v.string(),
    takeover: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, channel } = await requireChannelAccess(ctx, args.channelId, Permission.Connect);
    await assertMayParticipate(ctx, userId);
    assertCallableKind(channel.kind);
    const policy = await loadVoicePolicy(ctx);
    if (!policy.enabled) {
      throw new ConvexError("Voice and video calls are disabled in this workspace");
    }
    if (args.kind === "video" && !policy.videoEnabled) {
      throw new ConvexError("Video calling is disabled in this workspace");
    }

    const live = await findLiveCall(ctx, args.channelId);
    const seat = await prepareSeat(ctx, {
      userId,
      clientId: args.clientId,
      takeover: args.takeover === true,
      call: live,
      maxParticipants: policy.maxParticipants,
    });

    if (live !== null) {
      await reuseLiveCall(ctx, live, seat, userId, args.clientId);
      return { callId: live._id, created: false };
    }

    const { callId, ringing } = await insertNewCall(ctx, args, channel, userId);
    if (ringing) {
      await ctx.scheduler.runAfter(0, internal.notifications.dispatchCallRinging, { callId });
      // Native mobile devices need their own wake path (web push targets web
      // subscriptions; this targets APNs/FCM/UnifiedPush tokens).
      await ctx.scheduler.runAfter(0, internal.notifications.dispatchMobileCallRinging, {
        callId,
      });
    }
    return { callId, created: true };
  },
});

/** Joins a call. The first person to answer a ringing call activates it. */
export const join = mutation({
  args: { callId: v.id("calls"), clientId: v.string(), takeover: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status === "ended") {
      throw new ConvexError("This call has ended");
    }
    await requireChannelAccess(ctx, call.channelId, Permission.Connect);
    await assertMayParticipate(ctx, userId);
    const policy = await loadVoicePolicy(ctx);
    if (!policy.enabled) {
      throw new ConvexError("Voice and video calls are disabled in this workspace");
    }
    if (call.kind === "video" && !policy.videoEnabled) {
      throw new ConvexError("Video calling is disabled in this workspace");
    }
    const seat = await prepareSeat(ctx, {
      userId,
      clientId: args.clientId,
      takeover: args.takeover === true,
      call,
      maxParticipants: policy.maxParticipants,
    });
    if (seat === "absent") {
      await insertParticipant(ctx, call._id, call.channelId, userId, assertClientId(args.clientId));
    }
    if (call.status === "ringing") {
      await ctx.db.patch(call._id, { status: "active", ringingUserIds: [], updatedAt: Date.now() });
    } else if (call.ringingUserIds.includes(userId)) {
      await ctx.db.patch(call._id, {
        ringingUserIds: call.ringingUserIds.filter((id) => id !== userId),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Leaves a call; the last participant out ends it. */
export const leave = mutation({
  args: { callId: v.id("calls"), clientId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const clientId = assertClientId(args.clientId);
    const call = await ctx.db.get(args.callId);
    if (call === null) {
      return null;
    }
    const participant = await findParticipant(ctx, call._id, userId);
    // A device that was kicked must not take the new device with it.
    if (participant !== null && heldByOtherDevice(participant, clientId)) {
      return null;
    }
    await removeParticipant(ctx, call, userId);
    await ctx.db.patch(call._id, {
      ringingUserIds: call.ringingUserIds.filter((id) => id !== userId),
      updatedAt: Date.now(),
    });
    await finishIfEmpty(ctx, call._id);
    return null;
  },
});

/** Declines a ringing call without joining. */
export const decline = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status !== "ringing") {
      return null;
    }
    const nextRinging = call.ringingUserIds.filter((id) => id !== userId);
    const participants = await ctx.db
      .query("callParticipants")
      .withIndex("by_call", (q) => q.eq("callId", call._id))
      .collect();
    // Only the initiator is left and nobody is being rung: give up.
    if (nextRinging.length === 0 && participants.length <= 1) {
      await endCall(ctx, call);
      return null;
    }
    await ctx.db.patch(call._id, { ringingUserIds: nextRinging, updatedAt: Date.now() });
    return null;
  },
});

/** Ends a call for everyone. Any participant (or a moderator) may do it. */
export const end = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null) {
      return null;
    }
    const { permissions } = await requireChannelAccess(ctx, call.channelId, Permission.Connect);
    const participant = await findParticipant(ctx, call._id, userId);
    const moderator =
      hasPermission(permissions, Permission.MuteMembers) ||
      hasPermission(permissions, Permission.MoveMembers);
    if (participant === null && !moderator && call.initiatorId !== userId) {
      throw new ConvexError("Only a participant can end this call");
    }
    await endCall(ctx, call);
    return null;
  },
});

/**
 * Updates the caller's own media flags. Video and screen sharing are gated by
 * their permissions so a role can be denied a camera or a stream.
 */
export const updateParticipant = mutation({
  args: {
    callId: v.id("calls"),
    clientId: v.string(),
    muted: v.optional(v.boolean()),
    deafened: v.optional(v.boolean()),
    video: v.optional(v.boolean()),
    sharingScreen: v.optional(v.boolean()),
    sfu: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status === "ended") {
      throw new ConvexError("This call has ended");
    }
    const { permissions } = await requireChannelAccess(ctx, call.channelId, Permission.Connect);
    const participant = await findParticipant(ctx, call._id, userId);
    if (participant === null || heldByOtherDevice(participant, assertClientId(args.clientId))) {
      throw new ConvexError("You are not in this call");
    }
    if (args.video === true && !hasPermission(permissions, Permission.UseVideo)) {
      throw new ConvexError("You cannot turn on your camera");
    }
    if (args.sharingScreen === true && !hasPermission(permissions, Permission.Stream)) {
      throw new ConvexError("You cannot share your screen");
    }
    await ctx.db.patch(participant._id, {
      ...(args.muted !== undefined ? { muted: args.muted } : {}),
      ...(args.deafened !== undefined ? { deafened: args.deafened } : {}),
      ...(args.video !== undefined ? { video: args.video } : {}),
      ...(args.sharingScreen !== undefined ? { sharingScreen: args.sharingScreen } : {}),
      ...(args.sfu !== undefined ? { sfu: args.sfu } : {}),
      lastSeen: Date.now(),
    });
    if (args.sharingScreen !== undefined) {
      if (args.sharingScreen) {
        // Only one screen share at a time across the call.
        const others = await ctx.db
          .query("callParticipants")
          .withIndex("by_call", (q) => q.eq("callId", call._id))
          .collect();
        for (const other of others) {
          if (other.userId !== userId && other.sharingScreen) {
            await ctx.db.patch(other._id, { sharingScreen: false });
          }
        }
        await ctx.db.patch(call._id, { screenShareUserId: userId, updatedAt: Date.now() });
      } else if (call.screenShareUserId === userId) {
        await ctx.db.patch(call._id, { screenShareUserId: undefined, updatedAt: Date.now() });
      }
    }
    return null;
  },
});

/** Keeps the participant row fresh so the sweep does not drop a live client. */
export const heartbeat = mutation({
  args: { callId: v.id("calls"), clientId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const participant = await findParticipant(ctx, args.callId, userId);
    const clientId = assertClientId(args.clientId);
    if (participant === null || heldByOtherDevice(participant, clientId)) {
      return null;
    }
    // A seat from before device tracking has no client id. The install that
    // is actually heartbeating claims it so other devices can see the mismatch.
    await ctx.db.patch(participant._id, {
      lastSeen: Date.now(),
      ...(participant.clientId === undefined
        ? { clientId, session: participant.session ?? 1 }
        : {}),
    });
    return null;
  },
});

/** Sends one WebRTC signalling envelope to another participant. */
export const signal = mutation({
  args: {
    callId: v.id("calls"),
    clientId: v.string(),
    toUserId: v.string(),
    kind: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("ice"),
      v.literal("renegotiate"),
    ),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status === "ended") {
      throw new ConvexError("This call has ended");
    }
    if (args.toUserId === userId) {
      throw new ConvexError("Cannot signal yourself");
    }
    const sender = await findParticipant(ctx, call._id, userId);
    if (sender === null || heldByOtherDevice(sender, assertClientId(args.clientId))) {
      throw new ConvexError("You are not in this call");
    }
    const receiver = await findParticipant(ctx, call._id, args.toUserId);
    if (receiver === null) {
      throw new ConvexError("Signalling target is not in this call");
    }
    if (args.payload.length > MAX_SIGNAL_BYTES) {
      throw new ConvexError("Signalling payload is too large");
    }
    await ctx.db.insert("callSignals", {
      callId: call._id,
      channelId: call.channelId,
      fromUserId: userId,
      toUserId: args.toUserId,
      kind: args.kind,
      payload: args.payload,
      session: sender.session ?? 0,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Marks signalling rows the caller has processed as consumed. */
export const ack = mutation({
  args: { signalIds: v.array(v.id("callSignals")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    for (const id of args.signalIds) {
      const row = await ctx.db.get(id);
      // Only the addressed recipient may consume a signal.
      if (row !== null && row.toUserId === userId) {
        await ctx.db.delete(id);
      }
    }
    return null;
  },
});

/** The active or ringing call on a channel, if any. */
export const forChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId } = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const active = await ctx.db
      .query("calls")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "active"),
      )
      .first();
    const ringing =
      active ??
      (await ctx.db
        .query("calls")
        .withIndex("by_channel_status", (q) =>
          q.eq("channelId", args.channelId).eq("status", "ringing"),
        )
        .first());
    return ringing === null || ringing === undefined
      ? null
      : await toCallSummary(ctx, ringing, userId);
  },
});

/** One call by id. */
export const get = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call === null) {
      return null;
    }
    const { userId } = await requireChannelAccess(ctx, call.channelId, Permission.ViewChannel);
    return await toCallSummary(ctx, call, userId);
  },
});

/** Calls currently ringing the caller. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const ringing = await ctx.db
      .query("calls")
      .withIndex("by_status", (q) => q.eq("status", "ringing"))
      .collect();
    const mine = ringing.filter((call) => call.ringingUserIds.includes(userId));
    return await Promise.all(mine.map((call) => toCallSummary(ctx, call, userId)));
  },
});

/**
 * Every live call the caller can see, so the sidebar can show "who is in a
 * voice channel" without opening each channel.
 */
export const activeCalls = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const live = await ctx.db
      .query("calls")
      .filter((q) => q.neq(q.field("status"), "ended"))
      .collect();
    if (live.length === 0) {
      return [];
    }
    const context = await loadPermissionContext(ctx, userId);
    const visible: CallSummary[] = [];
    for (const call of live) {
      const channel = await ctx.db.get(call.channelId);
      if (channel === null) {
        continue;
      }
      if (channel.private === true || isDmKind(channel.kind)) {
        const member = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", userId))
          .unique();
        if (member === null) {
          continue;
        }
      } else {
        const categoryOverrides = await categoryOverridesFor(ctx, channel);
        const permissions = channelPermissions(context, channel, categoryOverrides);
        if (!hasPermission(permissions, Permission.ViewChannel)) {
          continue;
        }
      }
      visible.push(await toCallSummary(ctx, call, userId));
    }
    return visible;
  },
});

/** Signalling rows addressed to the caller for one call. */
export const signals = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const rows = await ctx.db
      .query("callSignals")
      .withIndex("by_call_to", (q) => q.eq("callId", args.callId).eq("toUserId", userId))
      .collect();
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id,
        callId: row.callId,
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
        kind: row.kind,
        payload: row.payload,
        session: row.session ?? 0,
        createdAt: row.createdAt,
      }));
  },
});

/**
 * Cron sweep: drop stale participants and signals, end abandoned or timed-out
 * calls, and prune ended calls after a short retention window.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const participants = await ctx.db.query("callParticipants").collect();
    for (const participant of participants) {
      const call = await ctx.db.get(participant.callId);
      if (
        call === null ||
        call.status === "ended" ||
        participant.lastSeen < now - PARTICIPANT_STALE_MS
      ) {
        await ctx.db.delete(participant._id);
      }
    }
    const signals = await ctx.db.query("callSignals").collect();
    for (const signal of signals) {
      if (signal.createdAt < now - SIGNAL_STALE_MS) {
        await ctx.db.delete(signal._id);
      }
    }
    const calls = await ctx.db.query("calls").collect();
    for (const call of calls) {
      if (call.status === "ended") {
        if ((call.endedAt ?? call.updatedAt) < now - CALL_RETENTION_MS) {
          await ctx.db.delete(call._id);
        }
        continue;
      }
      const members = await ctx.db
        .query("callParticipants")
        .withIndex("by_call", (q) => q.eq("callId", call._id))
        .collect();
      if (members.length === 0) {
        await endCall(ctx, call);
        continue;
      }
      if (call.status === "ringing" && call.startedAt < now - RING_TIMEOUT_MS) {
        await endCall(ctx, call);
      }
    }
    return null;
  },
});
