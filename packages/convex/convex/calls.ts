import { hasPermission, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import {
  assertCallableKind,
  assertClientId,
  CALL_RETENTION_MS,
  type CallSummary,
  cancelAloneJob,
  distinctParticipantCount,
  endCall,
  findLiveCall,
  findParticipant,
  finishIfEmpty,
  heldByOtherDevice,
  insertNewCall,
  insertParticipant,
  loadCallSeats,
  loadVoicePolicy,
  MAX_SIGNAL_BATCH,
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
import { getCallAloneTimeoutSeconds } from "./lib/env";
import { loadEffectiveEnv } from "./lib/envOverrides";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";

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

/** Stale participant/signal rows processed per sweep run before rescheduling. */
const SWEEP_BATCH = 500;

/** Generous per-user budget for Stay presses: 12 per minute. */
const STAY_RATE_LIMIT = 12;
const STAY_RATE_WINDOW_MS = 60_000;
/**
 * A Stay that moves the deadline by less than this is a no-op, so a burst of
 * presses (or a click immediately after the window was armed) cannot churn the
 * scheduler.
 */
const MIN_STAY_EXTENSION_MS = 3_000;

/**
 * The workspace's effective solo-call timeout, in milliseconds. Read only when
 * a timer is armed or reset, never from a subscribed query, so the five-minute
 * default costs nothing on the hot roster path.
 */
async function aloneTimeoutMs(ctx: MutationCtx): Promise<number> {
  const env = (await loadEffectiveEnv(ctx)).env;
  return getCallAloneTimeoutSeconds(env) * 1000;
}

/**
 * Schedules the single enforcement job for `deadline` and remembers its id.
 * `deadline` is passed to the job so a job from an older window can recognize
 * that it no longer owns the call and exit without rescheduling.
 */
async function scheduleAloneJob(
  ctx: MutationCtx,
  callId: Id<"calls">,
  delayMs: number,
  deadline: number,
): Promise<void> {
  const jobId = await ctx.scheduler.runAfter(delayMs, internal.calls.enforceAlone, {
    callId,
    deadline,
  });
  await ctx.db.patch(callId, { aloneJobId: jobId });
}

/** Arms (or re-arms) the solo-call deadline and replaces its enforcement job. */
async function armAloneTimer(
  ctx: MutationCtx,
  call: Doc<"calls">,
  now: number = Date.now(),
  timeoutMs?: number,
): Promise<void> {
  const windowMs = timeoutMs ?? (await aloneTimeoutMs(ctx));
  // Re-arming replaces the previous job, so repeated stays cannot accumulate a
  // chain of pending enforcements.
  await cancelAloneJob(ctx, call.aloneJobId);
  const deadline = now + windowMs;
  const jobId = await ctx.scheduler.runAfter(windowMs, internal.calls.enforceAlone, {
    callId: call._id,
    deadline,
  });
  await ctx.db.patch(call._id, {
    aloneSince: now,
    aloneDeadline: deadline,
    aloneJobId: jobId,
  });
}

async function clearAloneTimer(ctx: MutationCtx, call: Doc<"calls">): Promise<void> {
  // An ended call keeps its window on purpose so the notice can name the
  // configured duration. A late leave or a duplicate enforcement must not
  // erase it.
  if (call.status === "ended") {
    return;
  }
  if (
    call.aloneSince === undefined &&
    call.aloneDeadline === undefined &&
    call.aloneJobId === undefined
  ) {
    return;
  }
  await cancelAloneJob(ctx, call.aloneJobId);
  await ctx.db.patch(call._id, {
    aloneSince: undefined,
    aloneDeadline: undefined,
    aloneJobId: undefined,
  });
}

/**
 * Keeps the solo-call deadline in step with the roster: the first moment a
 * call has exactly one distinct user arms a fresh solo window, and any second
 * participant clears it so a later solo stretch starts over. A window that is
 * already due ends the call (the scheduled job normally gets there first; this
 * is the backstop when it was lost).
 *
 * "Alone" means one signed-in user, not one device: seats are per user, so two
 * devices of the same person still count as one participant. Bots are not a
 * separate participant kind in this product, so a bot that held a real seat
 * would count like anyone else.
 */
async function syncAloneState(
  ctx: MutationCtx,
  call: Doc<"calls">,
  distinct: number,
  now: number = Date.now(),
): Promise<void> {
  // The window retained on an alone-ended call is reporting state, not a
  // timer: a late leave or a duplicate enforcement must leave it untouched.
  if (call.status === "ended") {
    return;
  }
  if (call.status !== "active" || distinct !== 1) {
    await clearAloneTimer(ctx, call);
    return;
  }
  if (call.aloneSince === undefined || call.aloneDeadline === undefined) {
    await armAloneTimer(ctx, call, now);
    return;
  }
  if (call.aloneDeadline <= now) {
    await endCall(ctx, call, { endedReason: "alone" });
    return;
  }
  // A window restored from an older release (or one whose job was lost) gets
  // its enforcement back without restarting the countdown.
  if (call.aloneJobId === undefined) {
    await scheduleAloneJob(ctx, call._id, call.aloneDeadline - now, call.aloneDeadline);
  }
}

/** Re-reads a call's roster and applies {@link syncAloneState}. */
async function syncAloneTimer(ctx: MutationCtx, callId: Id<"calls">): Promise<void> {
  const call = await ctx.db.get(callId);
  if (call === null) {
    return;
  }
  const seats = await loadCallSeats(ctx, callId);
  await syncAloneState(ctx, call, distinctParticipantCount(seats));
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
    const { seat, leftCallIds } = await prepareSeat(ctx, {
      userId,
      clientId: args.clientId,
      takeover: args.takeover === true,
      call: live,
      maxParticipants: policy.maxParticipants,
    });
    // Switching calls on one device can leave the previous call solo.
    for (const leftCallId of leftCallIds) {
      await syncAloneTimer(ctx, leftCallId);
    }

    if (live !== null) {
      await reuseLiveCall(ctx, live, seat, userId, args.clientId);
      await syncAloneTimer(ctx, live._id);
      return { callId: live._id, created: false };
    }

    const { callId, ringing } = await insertNewCall(ctx, args, channel, userId);
    await syncAloneTimer(ctx, callId);
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
    const { seat, leftCallIds } = await prepareSeat(ctx, {
      userId,
      clientId: args.clientId,
      takeover: args.takeover === true,
      call,
      maxParticipants: policy.maxParticipants,
    });
    for (const leftCallId of leftCallIds) {
      await syncAloneTimer(ctx, leftCallId);
    }
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
    // A ringing call that just became active with its initiator alone, or a
    // seat added to an already-solo call, starts the solo window here.
    await syncAloneTimer(ctx, call._id);
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
    // The second-to-last person leaving starts the solo window; a call that
    // just ended clears nothing.
    await syncAloneTimer(ctx, call._id);
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
    await syncAloneTimer(ctx, call._id);
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
    sfuCall: v.optional(v.boolean()),
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
      ...(args.sfuCall !== undefined ? { sfuCall: args.sfuCall } : {}),
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

/**
 * Resets the solo-call countdown for the caller. This is the one well-defined
 * "I am still here" signal: ordinary mute, deafen, camera and screen changes
 * deliberately do **not** reset it, so the rule stays predictable and a
 * backgrounded client cannot keep an empty call alive by toggling media.
 *
 * Safe to call from a client that does not know the feature (the mutation is
 * additive). It is a no-op when the call is not solo or the press would move
 * the deadline by less than a few seconds, and it rejects a caller whose seat
 * is held by another device.
 */
export const stay = mutation({
  args: { callId: v.id("calls"), clientId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status !== "active") {
      return null;
    }
    await requireChannelAccess(ctx, call.channelId, Permission.Connect);
    const participant = await findParticipant(ctx, call._id, userId);
    if (participant === null || heldByOtherDevice(participant, assertClientId(args.clientId))) {
      throw new ConvexError("You are not in this call");
    }
    const seats = await loadCallSeats(ctx, call._id);
    if (distinctParticipantCount(seats) !== 1) {
      return null;
    }
    const now = Date.now();
    const timeoutMs = await aloneTimeoutMs(ctx);
    const deadline = now + timeoutMs;
    // A press just after arming would move the deadline by milliseconds.
    // Ignore it so a burst cannot churn the scheduler or burn the budget.
    if (call.aloneDeadline !== undefined && deadline - call.aloneDeadline < MIN_STAY_EXTENSION_MS) {
      return null;
    }
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("call-stay", userId),
      limit: STAY_RATE_LIMIT,
      windowMs: STAY_RATE_WINDOW_MS,
    });
    await armAloneTimer(ctx, call, now, timeoutMs);
    return null;
  },
});

/**
 * The end of a solo-call window. Scheduled by `armAloneTimer` with the deadline
 * it was armed for and re-validated here because the roster can change while
 * it waits. A job whose deadline no longer matches the call's current
 * `aloneDeadline` is stale: it exits immediately and does not reschedule, so
 * repeated re-arms can never leave a chain of pending enforcements.
 *
 * Removing the last participant ends the call through `endCall`, which is what
 * tells every client (including ones from before this feature) to tear down.
 */
export const enforceAlone = internalMutation({
  // `deadline` is optional so a job scheduled by a previous release (which
  // passed only `callId`) still runs safely against this handler.
  args: { callId: v.id("calls"), deadline: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call === null) {
      return null;
    }
    if (args.deadline === undefined) {
      // A deadline-less job was scheduled by a previous release and is not the
      // tracked enforcement for the current window. Never clear or replace an
      // existing `aloneJobId` and never schedule another job: the 30s sweep
      // restores enforcement if it is missing. Just end a still-solo call whose
      // current window is already overdue.
      const seats = await loadCallSeats(ctx, args.callId);
      if (
        call.status === "active" &&
        distinctParticipantCount(seats) === 1 &&
        call.aloneSince !== undefined &&
        call.aloneDeadline !== undefined &&
        call.aloneDeadline <= Date.now()
      ) {
        await endCall(ctx, call, { endedReason: "alone" });
      }
      return null;
    }
    if (call.aloneDeadline !== args.deadline) {
      // A newer window owns the call; this job is already canceled. Do not
      // schedule another one for the old or the new deadline.
      return null;
    }
    // This is the current job. Forget its id before any path below cancels
    // "the pending job", which would be this running mutation itself.
    const { aloneJobId: firedJobId, ...current } = call;
    if (firedJobId !== undefined) {
      await ctx.db.patch(call._id, { aloneJobId: undefined });
    }
    const seats = await loadCallSeats(ctx, args.callId);
    const distinct = distinctParticipantCount(seats);
    if (current.status !== "active" || distinct !== 1) {
      await syncAloneState(ctx, current, distinct);
      return null;
    }
    if (current.aloneSince === undefined || current.aloneDeadline === undefined) {
      await armAloneTimer(ctx, current);
      return null;
    }
    const now = Date.now();
    if (now < current.aloneDeadline) {
      // Same window, fired a hair early: wait out the remainder with the one
      // tracked job instead of relying on the 30s sweep.
      await scheduleAloneJob(ctx, current._id, current.aloneDeadline - now, current.aloneDeadline);
      return null;
    }
    await endCall(ctx, current, { endedReason: "alone" });
    return null;
  },
});

/**
 * Sends one WebRTC signalling envelope to another participant.
 *
 * `payloads` adds pooled ICE candidates to the same envelope (one write instead
 * of one per candidate). It is optional and `payload` stays accepted, so a
 * client from before batching keeps working against this backend; the batched
 * client repeats the first payload in `payload` so an older backend can still
 * take the signal.
 */
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
    payload: v.optional(v.string()),
    payloads: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const payloads =
      args.payloads !== undefined && args.payloads.length > 0
        ? args.payloads
        : args.payload !== undefined
          ? [args.payload]
          : [];
    if (payloads.length === 0) {
      throw new ConvexError("A signal needs a payload");
    }
    if (payloads.length > MAX_SIGNAL_BATCH) {
      throw new ConvexError("Too many signalling payloads");
    }
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
    for (const payload of payloads) {
      if (payload.length > MAX_SIGNAL_BYTES) {
        throw new ConvexError("Signalling payload is too large");
      }
    }
    const session = sender.session ?? 0;
    const createdAt = Date.now();
    for (const payload of payloads) {
      await ctx.db.insert("callSignals", {
        callId: call._id,
        channelId: call.channelId,
        fromUserId: userId,
        toUserId: args.toUserId,
        kind: args.kind,
        payload,
        session,
        createdAt,
      });
    }
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
    // Read the two live statuses straight off `by_status` instead of scanning
    // the whole table and post-filtering `status !== "ended"`.
    const [ringing, active] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_status", (q) => q.eq("status", "ringing"))
        .collect(),
      ctx.db
        .query("calls")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
    ]);
    const live = [...ringing, ...active].sort((a, b) => a._creationTime - b._creationTime);
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
 *
 * Each table is read by index rather than collected: participants past the
 * heartbeat cutoff via `by_lastSeen`, orphaned envelopes past their age via
 * `by_created`, and live calls via `by_status`. Stale rows are deleted one
 * bounded batch at a time and the sweep reschedules itself while a batch is
 * full, so cleanup scales with the number of stale rows instead of total call
 * volume. `endCall` still clears a call's participants and signalling, so an
 * ended call never leaves seats behind.
 *
 * It also re-validates the solo-call deadline: a scheduled `enforceAlone` is
 * the primary trigger, and this pass arms a solo call whose hook was missed
 * and ends one whose window already elapsed.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const staleParticipants = await ctx.db
      .query("callParticipants")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", now - PARTICIPANT_STALE_MS))
      .take(SWEEP_BATCH);
    for (const participant of staleParticipants) {
      await ctx.db.delete(participant._id);
    }

    const staleSignals = await ctx.db
      .query("callSignals")
      .withIndex("by_created", (q) => q.lt("createdAt", now - SIGNAL_STALE_MS))
      .take(SWEEP_BATCH);
    for (const signal of staleSignals) {
      await ctx.db.delete(signal._id);
    }

    // The non-ended statuses are the only calls that can still change state;
    // read them straight off `by_status` instead of scanning every call row.
    for (const status of ["ringing", "active"] as const) {
      const calls = await ctx.db
        .query("calls")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const call of calls) {
        const members = await loadCallSeats(ctx, call._id);
        if (members.length === 0) {
          await endCall(ctx, call);
          continue;
        }
        if (call.status === "ringing") {
          if (call.startedAt < now - RING_TIMEOUT_MS) {
            await endCall(ctx, call);
          }
          continue;
        }
        // Backstop for a lost scheduled job: arm a call that became solo
        // without a hook (a migration, a deletion path) and finish one whose
        // window has already passed. Bounded: the roster was just read.
        await syncAloneState(ctx, call, distinctParticipantCount(members), now);
      }
    }

    // Ended calls are retained briefly so clients can settle, then removed.
    const ended = await ctx.db
      .query("calls")
      .withIndex("by_status", (q) => q.eq("status", "ended"))
      .collect();
    for (const call of ended) {
      if ((call.endedAt ?? call.updatedAt) < now - CALL_RETENTION_MS) {
        await ctx.db.delete(call._id);
      }
    }

    if (staleParticipants.length === SWEEP_BATCH || staleSignals.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.calls.sweep, {});
    }
    return null;
  },
});
