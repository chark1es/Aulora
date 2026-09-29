import { hasPermission, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
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

/** A participant is considered gone after this long without a heartbeat. */
export const PARTICIPANT_STALE_MS = 45_000;
/** How long a ringing DM call waits for an answer before giving up. */
export const RING_TIMEOUT_MS = 60_000;
/** Signalling rows older than this are dropped; a peer that never pulled them is gone. */
export const SIGNAL_STALE_MS = 60_000;
/** Ended calls are retained briefly so clients can settle, then removed. */
export const CALL_RETENTION_MS = 5 * 60_000;
/** Hard cap on a single signalling payload (SDP with a large candidate list). */
const MAX_SIGNAL_BYTES = 65_536;

type ReadCtx = QueryCtx | MutationCtx;

interface CallParticipantSummary {
  readonly userId: string;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly joinedAt: number;
  readonly speaking: boolean;
  readonly audioLevel: number;
  readonly connection: "connecting" | "connected" | "reconnecting" | "failed";
}

interface CallSummary {
  readonly id: Id<"calls">;
  readonly channelId: Id<"channels">;
  readonly kind: Doc<"calls">["kind"];
  readonly status: Doc<"calls">["status"];
  readonly initiatorId: string;
  readonly ringingUserIds: readonly string[];
  readonly screenShareUserId: string | null;
  readonly startedAt: number;
  readonly participants: readonly CallParticipantSummary[];
}

/** Loads a call's participants as client views (media state is client-local). */
async function loadParticipants(
  ctx: ReadCtx,
  callId: Id<"calls">,
): Promise<CallParticipantSummary[]> {
  const rows = await ctx.db
    .query("callParticipants")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  return rows
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((row) => ({
      userId: row.userId,
      muted: row.muted,
      deafened: row.deafened,
      video: row.video,
      sharingScreen: row.sharingScreen,
      joinedAt: row.joinedAt,
      speaking: false,
      audioLevel: 0,
      connection: "connected" as const,
    }));
}

async function toCallSummary(ctx: ReadCtx, call: Doc<"calls">): Promise<CallSummary> {
  return {
    id: call._id,
    channelId: call.channelId,
    kind: call.kind,
    status: call.status,
    initiatorId: call.initiatorId,
    ringingUserIds: call.ringingUserIds,
    screenShareUserId: call.screenShareUserId ?? null,
    startedAt: call.startedAt,
    participants: await loadParticipants(ctx, call._id),
  };
}

/** The workspace voice policy, defaulting to enabled for pre-voice rows. */
async function loadVoicePolicy(ctx: ReadCtx) {
  const server = await ctx.db.query("server").first();
  return {
    enabled: server?.settings.voiceEnabled ?? true,
    videoEnabled: server?.settings.videoEnabled ?? true,
    screenShareEnabled: server?.settings.screenShareEnabled ?? true,
    maxParticipants: server?.settings.maxCallParticipants ?? 10,
  };
}

/** Calls only live on voice channels and DMs/group DMs. */
function assertCallableKind(kind: Doc<"channels">["kind"]): void {
  if (kind === "text" || kind === "announcement") {
    throw new ConvexError("Calls are only available in voice channels and direct messages");
  }
}

async function findParticipant(
  ctx: ReadCtx,
  callId: Id<"calls">,
  userId: string,
): Promise<Doc<"callParticipants"> | null> {
  return await ctx.db
    .query("callParticipants")
    .withIndex("by_call_user", (q) => q.eq("callId", callId).eq("userId", userId))
    .unique();
}

/** Deletes every signalling row touching a user, in either direction. */
async function clearSignalsFor(
  ctx: MutationCtx,
  callId: Id<"calls">,
  userId: string,
): Promise<void> {
  const rows = await ctx.db
    .query("callSignals")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  for (const row of rows) {
    if (row.fromUserId === userId || row.toUserId === userId) {
      await ctx.db.delete(row._id);
    }
  }
}

async function removeParticipant(
  ctx: MutationCtx,
  call: Doc<"calls">,
  userId: string,
): Promise<void> {
  const participant = await findParticipant(ctx, call._id, userId);
  if (participant !== null) {
    await ctx.db.delete(participant._id);
  }
  await clearSignalsFor(ctx, call._id, userId);
  if (call.screenShareUserId === userId) {
    await ctx.db.patch(call._id, { screenShareUserId: undefined, updatedAt: Date.now() });
  }
}

/** Ends a call: clears participants, signalling and ringing, marks it ended. */
async function endCall(ctx: MutationCtx, call: Doc<"calls">): Promise<void> {
  const participants = await ctx.db
    .query("callParticipants")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .collect();
  for (const participant of participants) {
    await ctx.db.delete(participant._id);
  }
  const signals = await ctx.db
    .query("callSignals")
    .withIndex("by_call", (q) => q.eq("callId", call._id))
    .collect();
  for (const signal of signals) {
    await ctx.db.delete(signal._id);
  }
  await ctx.db.patch(call._id, {
    status: "ended",
    ringingUserIds: [],
    screenShareUserId: undefined,
    endedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * Starts (or reuses) the call on a channel. A DM/group-DM call begins ringing;
 * a voice-channel call is active immediately and others join when they want.
 */
export const start = mutation({
  args: {
    channelId: v.id("channels"),
    kind: v.union(v.literal("voice"), v.literal("video")),
    ringingUserIds: v.optional(v.array(v.string())),
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

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "active"),
      )
      .first();
    const ringing = await ctx.db
      .query("calls")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "ringing"),
      )
      .first();
    const live = existing ?? ringing;

    if (live !== null && live !== undefined) {
      const already = await findParticipant(ctx, live._id, userId);
      if (already === null) {
        if ((await loadParticipants(ctx, live._id)).length >= policy.maxParticipants) {
          throw new ConvexError("This call is full");
        }
        await ctx.db.insert("callParticipants", {
          callId: live._id,
          channelId: live.channelId,
          userId,
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
      return { callId: live._id, created: false };
    }

    // DM/group-DM calls ring the other participants; voice channels do not.
    let ringingUserIds: string[] = [];
    if (isDmKind(channel.kind)) {
      const membership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .collect();
      // Only current channel members may be rung: an arbitrary id supplied by
      // the caller is dropped rather than turned into a ringing target.
      const memberIds = new Set(membership.map((row) => row.userId));
      memberIds.delete(userId);
      if (args.ringingUserIds !== undefined) {
        ringingUserIds = args.ringingUserIds.filter((id) => memberIds.has(id));
      } else {
        ringingUserIds = [...memberIds];
      }
    }

    const now = Date.now();
    const callId = await ctx.db.insert("calls", {
      channelId: args.channelId,
      kind: args.kind,
      initiatorId: userId,
      status: ringingUserIds.length > 0 ? "ringing" : "active",
      ringingUserIds,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("callParticipants", {
      callId,
      channelId: args.channelId,
      userId,
      muted: false,
      deafened: false,
      video: false,
      sharingScreen: false,
      joinedAt: now,
      lastSeen: now,
    });
    if (ringingUserIds.length > 0) {
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
  args: { callId: v.id("calls") },
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
    const already = await findParticipant(ctx, call._id, userId);
    if (already === null) {
      if ((await loadParticipants(ctx, call._id)).length >= policy.maxParticipants) {
        throw new ConvexError("This call is full");
      }
      await ctx.db.insert("callParticipants", {
        callId: call._id,
        channelId: call.channelId,
        userId,
        muted: false,
        deafened: false,
        video: false,
        sharingScreen: false,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
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
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null) {
      return null;
    }
    await removeParticipant(ctx, call, userId);
    await ctx.db.patch(call._id, {
      ringingUserIds: call.ringingUserIds.filter((id) => id !== userId),
      updatedAt: Date.now(),
    });
    const remaining = await ctx.db
      .query("callParticipants")
      .withIndex("by_call", (q) => q.eq("callId", call._id))
      .collect();
    if (remaining.length === 0) {
      await endCall(ctx, call);
    }
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
    muted: v.optional(v.boolean()),
    deafened: v.optional(v.boolean()),
    video: v.optional(v.boolean()),
    sharingScreen: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status === "ended") {
      throw new ConvexError("This call has ended");
    }
    const { permissions } = await requireChannelAccess(ctx, call.channelId, Permission.Connect);
    const participant = await findParticipant(ctx, call._id, userId);
    if (participant === null) {
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
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const participant = await findParticipant(ctx, args.callId, userId);
    if (participant !== null) {
      await ctx.db.patch(participant._id, { lastSeen: Date.now() });
    }
    return null;
  },
});

/** Sends one WebRTC signalling envelope to another participant. */
export const signal = mutation({
  args: {
    callId: v.id("calls"),
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
    if (sender === null) {
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
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
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
    return ringing === null || ringing === undefined ? null : await toCallSummary(ctx, ringing);
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
    await requireChannelAccess(ctx, call.channelId, Permission.ViewChannel);
    return await toCallSummary(ctx, call);
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
    return await Promise.all(mine.map((call) => toCallSummary(ctx, call)));
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
      visible.push(await toCallSummary(ctx, call));
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

/** Internal helper kept for feature parity with the other domain modules. */
export async function isCallMember(
  ctx: ReadCtx,
  callId: Id<"calls">,
  userId: string,
): Promise<boolean> {
  return (await findParticipant(ctx, callId, userId)) !== null;
}
