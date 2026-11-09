import { GUEST_SIGNAL_ACK_MAX, transcriptionSpeakerKey } from "@aulora/core";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { requireChannelAccess } from "./channels";
import { isDmKind } from "./channels";
import { randomToken } from "./crypto";
import { getCallAloneTimeoutSeconds } from "./env";
import { loadEffectiveEnv } from "./envOverrides";
import {
  endGuestSessionsForCall,
  openGuestParticipantName,
  sealGuestParticipantName,
} from "./guestCalls";
import {
  activeSessionForCall,
  endTranscriptionForCall,
  markTranscriptionSpeakerLeft,
} from "./transcription";
import type { Nullable } from "./types";

/** Client install ids are opaque tokens, not free-form strings. */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

/** A participant is considered gone after this long without a heartbeat. */
export const PARTICIPANT_STALE_MS = 45_000;
/** How long a ringing DM call waits for an answer before giving up. */
export const RING_TIMEOUT_MS = 60_000;
/** Signalling rows older than this are dropped; a peer that never pulled them is gone. */
export const SIGNAL_STALE_MS = 60_000;
/** Ended calls are retained briefly so clients can settle, then removed. */
export const CALL_RETENTION_MS = 5 * 60_000;
/** Hard cap on a single signalling payload (SDP with a large candidate list). */
export const MAX_SIGNAL_BYTES = 65_536;
/**
 * Hard cap on how many payloads one signal may carry. The client pools ICE
 * candidates for ~75 ms and flushes at 16, so this is a safety ceiling.
 */
export const MAX_SIGNAL_BATCH = GUEST_SIGNAL_ACK_MAX;
/**
 * Bound on the participant rows read when counting a call's seats. Workspace
 * settings cap a call at 50, so a read at this size always sees every seat and
 * can never be mistaken for a full-table scan.
 */
export const MAX_CALL_SEATS = 64;

export type ReadCtx = Parameters<typeof requireChannelAccess>[0];

export interface CallParticipantSummary {
  /**
   * Participant key: the member's account id, or the guest session id for a
   * guest. Signalling and per-participant actions address this value.
   */
  readonly userId: string;
  /** The guest session id when this is a guest, else `null`. */
  readonly guestId: Id<"callGuestSessions"> | null;
  readonly isGuest: boolean;
  /** The guest's sealed display name, opened for the roster; `null` for members. */
  readonly displayName: string | null;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly sfu: boolean;
  /** The device can carry microphone and camera through the streaming server. */
  readonly sfuCall: boolean;
  readonly joinedAt: number;
  /** Present only for the viewer's own row. */
  readonly clientId: string | null;
  readonly session: number;
  readonly speaking: boolean;
  readonly audioLevel: number;
  readonly connection: "connecting" | "connected" | "reconnecting" | "failed";
}

export interface CallSummary {
  readonly id: Id<"calls">;
  /**
   * The channel a call lives on, or `null` for a standalone scheduled room.
   * Additive widening: older clients that always receive a channel are
   * unaffected, and the scheduled-call UI is the only consumer of `null`.
   */
  readonly channelId: Id<"channels"> | null;
  readonly kind: Doc<"calls">["kind"];
  readonly status: Doc<"calls">["status"];
  readonly initiatorId: string;
  readonly ringingUserIds: readonly string[];
  readonly screenShareUserId: string | null;
  readonly startedAt: number;
  readonly participants: readonly CallParticipantSummary[];
  /**
   * True while a transcription session is active on this call. Every
   * participant, including a guest, sees the indicator and the notice.
   */
  readonly transcribing: boolean;
  readonly transcriptionSessionId: Id<"transcriptionSessions"> | null;
  /** Set when this call was created for a scheduled call. */
  readonly scheduledCallId: Id<"scheduledCalls"> | null;
  /** True when the call has no channel (a standalone scheduled room). */
  readonly standalone: boolean;
  readonly guestCount: number;
  /**
   * Server clock time at which a still-solo call is disconnected, or `null`
   * when the call has more than one participant. Additive: older clients
   * ignore it, and older backends omit it (the client then hides the hint).
   */
  readonly aloneDeadline: number | null;
  /**
   * The workspace's solo-call window in seconds, or `null` when it no longer
   * applies. Kept on a call that ended for being solo so the notice can name
   * the configured duration instead of assuming five minutes.
   */
  readonly aloneTimeoutSeconds: number | null;
  /** Why the call ended, when not just its last person leaving. */
  readonly endedReason: string | null;
}

/**
 * A call's participant rows, read in one bounded batch. A seat count at the
 * cap already means "more than one user", so the solo check never needs the
 * rest of an oversized roster.
 */
export async function loadCallSeats(
  ctx: ReadCtx,
  callId: Id<"calls">,
): Promise<Doc<"callParticipants">[]> {
  return await ctx.db
    .query("callParticipants")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .take(MAX_CALL_SEATS);
}

/** Distinct users in a call; devices never add a second participant. */
export function distinctParticipantCount(rows: readonly Doc<"callParticipants">[]): number {
  return new Set(rows.map((row) => row.userId)).size;
}

/**
 * The opaque signalling key a guest uses to address a member: the per-call
 * `guestKey` (legacy member rows fall back to the account id, which every
 * current row also already has). A guest row's key is its session id. This is
 * not an offer-election key: election uses account ids and the guest roster's
 * `shouldOffer` bit.
 */
export function participantSignalKey(row: Doc<"callParticipants">): string {
  if (row.guestId !== undefined) {
    return row.userId;
  }
  return row.guestKey ?? row.userId;
}

/**
 * Loads a call's participants as client views (media state is client-local).
 * A guest's display-name snapshot is opened here; members keep their profile
 * name on the client's member map.
 */
export async function loadParticipants(
  ctx: ReadCtx,
  callId: Id<"calls">,
  viewerId: string,
): Promise<CallParticipantSummary[]> {
  const rows = await loadCallSeats(ctx, callId);
  return await Promise.all(
    rows
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(async (row) => ({
        userId: row.userId,
        guestId: row.guestId ?? null,
        isGuest: row.guestId !== undefined,
        displayName: row.guestId === undefined ? null : await openGuestParticipantName(row),
        muted: row.muted,
        deafened: row.deafened,
        video: row.video,
        sharingScreen: row.sharingScreen,
        sfu: row.sfu ?? false,
        sfuCall: row.sfuCall ?? false,
        joinedAt: row.joinedAt,
        clientId: row.userId === viewerId ? (row.clientId ?? null) : null,
        session: row.session ?? 0,
        speaking: false,
        audioLevel: 0,
        connection: "connected" as const,
      })),
  );
}

export async function toCallSummary(
  ctx: ReadCtx,
  call: Doc<"calls">,
  viewerId: string,
): Promise<CallSummary> {
  const [participants, activeSession] = await Promise.all([
    loadParticipants(ctx, call._id, viewerId),
    activeSessionForCall(ctx, call._id),
  ]);
  return {
    id: call._id,
    channelId: call.channelId ?? null,
    kind: call.kind,
    status: call.status,
    initiatorId: call.initiatorId,
    ringingUserIds: call.ringingUserIds,
    screenShareUserId: call.screenShareUserId ?? null,
    startedAt: call.startedAt,
    participants,
    transcribing: activeSession !== null,
    transcriptionSessionId: activeSession?._id ?? null,
    scheduledCallId: call.scheduledCallId ?? null,
    standalone: call.channelId === undefined,
    guestCount: participants.filter((participant) => participant.isGuest).length,
    aloneDeadline: call.aloneDeadline ?? null,
    aloneTimeoutSeconds:
      call.aloneSince !== undefined && call.aloneDeadline !== undefined
        ? Math.round((call.aloneDeadline - call.aloneSince) / 1000)
        : null,
    endedReason: call.endedReason ?? null,
  };
}

export function assertClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (!CLIENT_ID_PATTERN.test(trimmed)) {
    throw new ConvexError("Invalid client");
  }
  return trimmed;
}

/** True when this row is held by a different install than `clientId`. */
export function heldByOtherDevice(row: Doc<"callParticipants">, clientId: string): boolean {
  return row.clientId !== undefined && row.clientId !== clientId;
}

/** The workspace voice policy, defaulting to enabled for pre-voice rows. */
export async function loadVoicePolicy(ctx: ReadCtx) {
  const server = await ctx.db.query("server").first();
  return {
    enabled: server?.settings.voiceEnabled ?? true,
    videoEnabled: server?.settings.videoEnabled ?? true,
    screenShareEnabled: server?.settings.screenShareEnabled ?? true,
    maxParticipants: server?.settings.maxCallParticipants ?? 10,
  };
}

/** Calls only live on voice channels and DMs/group DMs. */
export function assertCallableKind(kind: Doc<"channels">["kind"]): void {
  if (kind === "text" || kind === "announcement") {
    throw new ConvexError("Calls are only available in voice channels and direct messages");
  }
}

export async function findParticipant(
  ctx: ReadCtx,
  callId: Id<"calls">,
  userId: string,
): Promise<Nullable<Doc<"callParticipants">>> {
  return await ctx.db
    .query("callParticipants")
    .withIndex("by_call_user", (q) => q.eq("callId", callId).eq("userId", userId))
    .unique();
}

/** Deletes every signalling row touching a user, in either direction. */
export async function clearSignalsFor(
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

export async function removeParticipant(
  ctx: MutationCtx,
  call: Doc<"calls">,
  userId: string,
  options: { readonly blocked?: boolean } = {},
): Promise<void> {
  const participant = await findParticipant(ctx, call._id, userId);
  if (participant !== null) {
    // Record the departure on the live transcription session before the seat
    // disappears, so the transcriber's final drain has a bounded grace.
    const speakerKey =
      participant.guestId !== undefined
        ? transcriptionSpeakerKey("guest", participant.guestId)
        : transcriptionSpeakerKey("user", participant.userId);
    await markTranscriptionSpeakerLeft(ctx, call._id, speakerKey, options);
    await ctx.db.delete(participant._id);
  }
  await clearSignalsFor(ctx, call._id, userId);
  if (call.screenShareUserId === userId) {
    await ctx.db.patch(call._id, { screenShareUserId: undefined, updatedAt: Date.now() });
  }
}

/**
 * Cancels a call's pending solo-call enforcement job. Cancelling a job that
 * has already run throws, which is harmless while ending a call: the outcome
 * it would have produced is already happening.
 */
export async function cancelAloneJob(
  ctx: MutationCtx,
  jobId: Id<"_scheduled_functions"> | undefined,
): Promise<void> {
  if (jobId === undefined) {
    return;
  }
  try {
    await ctx.scheduler.cancel(jobId);
  } catch {
    // Already completed: there is nothing left to cancel.
  }
}

/**
 * The workspace's effective solo-call timeout, in milliseconds. Read only when
 * a timer is armed or reset, never from a subscribed query, so the five-minute
 * default costs nothing on the hot roster path.
 */
export async function aloneTimeoutMs(ctx: MutationCtx): Promise<number> {
  const env = (await loadEffectiveEnv(ctx)).env;
  return getCallAloneTimeoutSeconds(env) * 1000;
}

/**
 * `deadline` is passed to the job so a job from an older window can recognize
 * that it no longer owns the call and exit without rescheduling.
 */
export async function scheduleAloneJob(
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
export async function armAloneTimer(
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
 * "Alone" means one distinct participant, not one device: seats are per user,
 * so two devices of the same person still count as one. A guest holds a seat
 * under its guest session id and counts as a distinct participant, so a host
 * with only a guest present is **not** alone. Bots are not a separate
 * participant kind in this product, so a bot that held a real seat would count
 * like anyone else.
 */
export async function syncAloneState(
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
export async function syncAloneTimerForCall(ctx: MutationCtx, callId: Id<"calls">): Promise<void> {
  const call = await ctx.db.get(callId);
  if (call === null) {
    return;
  }
  const seats = await loadCallSeats(ctx, callId);
  await syncAloneState(ctx, call, distinctParticipantCount(seats));
}

/** Ends a call: clears participants, signalling and ringing, marks it ended. */
export async function endCall(
  ctx: MutationCtx,
  call: Doc<"calls">,
  options: { readonly endedReason?: Doc<"calls">["endedReason"] } = {},
): Promise<void> {
  await cancelAloneJob(ctx, call.aloneJobId);
  const now = Date.now();
  // End the addon state first: the transcription session must stop accepting
  // segments, and admitted guests must not keep a token for a dead call.
  await endTranscriptionForCall(ctx, call._id, now);
  await endGuestSessionsForCall(ctx, call._id, now);
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
    // The enforcement job that may have triggered this end has fired; keep the
    // window on an alone-ended call so the client notice can name the
    // configured duration, but every other end clears it.
    aloneJobId: undefined,
    ...(options.endedReason === "alone" ? {} : { aloneSince: undefined, aloneDeadline: undefined }),
    ...(options.endedReason !== undefined ? { endedReason: options.endedReason } : {}),
    endedAt: now,
    updatedAt: now,
  });
}

export async function finishIfEmpty(ctx: MutationCtx, callId: Id<"calls">): Promise<void> {
  const call = await ctx.db.get(callId);
  if (call === null || call.status === "ended") {
    return;
  }
  const remaining = await ctx.db
    .query("callParticipants")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  if (remaining.length === 0) {
    await endCall(ctx, call);
  }
}

export async function insertParticipant(
  ctx: MutationCtx,
  callId: Id<"calls">,
  channelId: Id<"channels"> | undefined,
  userId: string,
  clientId: string,
): Promise<void> {
  const now = Date.now();
  await ctx.db.insert("callParticipants", {
    callId,
    ...(channelId !== undefined ? { channelId } : {}),
    userId,
    guestKey: randomToken(16),
    clientId,
    session: 1,
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
    joinedAt: now,
    lastSeen: now,
  });
}

/**
 * Seats an admitted guest. The row's `userId` is the guest session id so the
 * existing per-user key, seat count and signalling routing work unchanged;
 * `guestId` names the real guest session and the sealed name is the roster
 * snapshot.
 */
export async function insertGuestParticipant(
  ctx: MutationCtx,
  call: Doc<"calls">,
  guestId: Id<"callGuestSessions">,
  displayName: string,
  clientId: string,
  options: { readonly muted?: boolean; readonly video?: boolean } = {},
): Promise<void> {
  const now = Date.now();
  const id = await ctx.db.insert("callParticipants", {
    callId: call._id,
    ...(call.channelId !== undefined ? { channelId: call.channelId } : {}),
    userId: guestId,
    guestId,
    guestKey: randomToken(16),
    clientId,
    session: 1,
    muted: options.muted ?? false,
    deafened: false,
    video: options.video ?? false,
    sharingScreen: false,
    joinedAt: now,
    lastSeen: now,
  });
  await ctx.db.patch(id, {
    guestNameCiphertext: await sealGuestParticipantName(id, displayName),
  });
}

/** The active or ringing call on a channel, if any. */
export async function findLiveCall(
  ctx: MutationCtx,
  channelId: Id<"channels">,
): Promise<Nullable<Doc<"calls">>> {
  const existing = await ctx.db
    .query("calls")
    .withIndex("by_channel_status", (q) => q.eq("channelId", channelId).eq("status", "active"))
    .first();
  const ringing = await ctx.db
    .query("calls")
    .withIndex("by_channel_status", (q) => q.eq("channelId", channelId).eq("status", "ringing"))
    .first();
  return existing ?? ringing ?? null;
}

/**
 * The users to ring when a DM/group-DM call starts. Only current channel
 * members may be rung: an arbitrary id supplied by the caller is dropped rather
 * than turned into a ringing target. Voice channels ring nobody.
 */
export async function ringingTargets(
  ctx: MutationCtx,
  channel: Doc<"channels">,
  userId: string,
  requested: readonly string[] | undefined,
): Promise<string[]> {
  if (!isDmKind(channel.kind)) {
    return [];
  }
  const membership = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
    .collect();
  const memberIds = new Set(membership.map((row) => row.userId));
  memberIds.delete(userId);
  if (requested !== undefined) {
    return requested.filter((id) => memberIds.has(id));
  }
  return [...memberIds];
}

/** Updates a reused live call for a seated participant. */
export async function reuseLiveCall(
  ctx: MutationCtx,
  live: Doc<"calls">,
  seat: "present" | "absent",
  userId: string,
  clientId: string,
): Promise<void> {
  if (seat === "absent") {
    await insertParticipant(ctx, live._id, live.channelId, userId, assertClientId(clientId));
  }
  if (live.status === "ringing") {
    await ctx.db.patch(live._id, {
      status: "active",
      ringingUserIds: [],
      updatedAt: Date.now(),
    });
  }
}

/**
 * Inserts a brand-new call plus the initiator's seat and returns whether it
 * began ringing (so the caller can schedule the wake fan-out).
 */
export async function insertNewCall(
  ctx: MutationCtx,
  args: {
    readonly channelId?: Id<"channels">;
    readonly scheduledCallId?: Id<"scheduledCalls">;
    readonly kind: "voice" | "video";
    readonly clientId: string;
    readonly ringingUserIds?: readonly string[];
  },
  channel: Doc<"channels"> | null,
  userId: string,
): Promise<{ callId: Id<"calls">; ringing: boolean }> {
  const ringingUserIds =
    channel === null ? [] : await ringingTargets(ctx, channel, userId, args.ringingUserIds);
  const now = Date.now();
  const callId = await ctx.db.insert("calls", {
    ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
    ...(args.scheduledCallId !== undefined ? { scheduledCallId: args.scheduledCallId } : {}),
    kind: args.kind,
    initiatorId: userId,
    status: ringingUserIds.length > 0 ? "ringing" : "active",
    ringingUserIds,
    startedAt: now,
    updatedAt: now,
  });
  await insertParticipant(ctx, callId, args.channelId, userId, assertClientId(args.clientId));
  return { callId, ringing: ringingUserIds.length > 0 };
}

/** Throws when the user already holds a seat on a different device. */
function assertNotOnOtherDevice(
  rows: readonly Doc<"callParticipants">[],
  clientId: string,
  takeover: boolean,
): void {
  const foreign = rows.filter((row) => row.clientId !== clientId);
  if (foreign.length > 0 && !takeover) {
    const other = foreign[0];
    if (other === undefined) {
      throw new ConvexError("You are already in a call on another device");
    }
    throw new ConvexError({
      code: "call_elsewhere",
      message: "You are already in a call on another device",
      callId: other.callId,
      channelId: other.channelId,
    });
  }
}

async function ensureSeatAvailable(
  ctx: MutationCtx,
  target: Doc<"calls">,
  alreadySeated: boolean,
  maxParticipants: number,
): Promise<void> {
  if (alreadySeated) {
    return;
  }
  const occupied = await ctx.db
    .query("callParticipants")
    .withIndex("by_call", (q) => q.eq("callId", target._id))
    .collect();
  if (occupied.length >= maxParticipants) {
    throw new ConvexError("This call is full");
  }
}

async function claimSeat(
  ctx: MutationCtx,
  row: Doc<"callParticipants">,
  target: Doc<"calls">,
  userId: string,
  clientId: string,
): Promise<void> {
  const takingOver = row.clientId !== clientId;
  await ctx.db.patch(row._id, {
    clientId,
    lastSeen: Date.now(),
    ...(takingOver
      ? {
          session: (row.session ?? 0) + 1,
          muted: false,
          deafened: false,
          video: false,
          sharingScreen: false,
        }
      : {}),
  });
  if (takingOver) {
    await clearSignalsFor(ctx, target._id, userId);
    if (target.screenShareUserId === userId) {
      await ctx.db.patch(target._id, {
        screenShareUserId: undefined,
        updatedAt: Date.now(),
      });
    }
  }
}

async function evictStaleSeat(
  ctx: MutationCtx,
  row: Doc<"callParticipants">,
  userId: string,
): Promise<Id<"calls"> | null> {
  const other = await ctx.db.get(row.callId);
  if (other !== null && other.status !== "ended") {
    await removeParticipant(ctx, other, userId);
    await finishIfEmpty(ctx, other._id);
    return other._id;
  }
  await ctx.db.delete(row._id);
  return null;
}

/** Where {@link prepareSeat} left the caller, and any call it emptied them from. */
export interface PreparedSeat {
  /** `present` when this call already had a row for the user. */
  readonly seat: "present" | "absent";
  /** Calls the user left because the same device switched to this one. */
  readonly leftCallIds: readonly Id<"calls">[];
}

/**
 * A user is in one call, from one device. The same device switching calls
 * drops the previous seat. A different device must pass `takeover`, which
 * disconnects the other one.
 */
export async function prepareSeat(
  ctx: MutationCtx,
  args: {
    readonly userId: string;
    readonly clientId: string;
    readonly takeover: boolean;
    readonly call: Nullable<Doc<"calls">>;
    readonly maxParticipants: number;
  },
): Promise<PreparedSeat> {
  const clientId = assertClientId(args.clientId);
  const rows = await ctx.db
    .query("callParticipants")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  assertNotOnOtherDevice(rows, clientId, args.takeover);

  const target = args.call;
  const here = target === null ? undefined : rows.find((row) => row.callId === target._id);
  if (target !== null) {
    await ensureSeatAvailable(ctx, target, here !== undefined, args.maxParticipants);
  }
  const leftCallIds: Id<"calls">[] = [];
  for (const row of rows) {
    if (target !== null && row.callId === target._id) {
      await claimSeat(ctx, row, target, args.userId, clientId);
    } else {
      const left = await evictStaleSeat(ctx, row, args.userId);
      if (left !== null) {
        leftCallIds.push(left);
      }
    }
  }
  return { seat: here === undefined ? "absent" : "present", leftCallIds };
}

/** Internal helper kept for feature parity with the other domain modules. */
export async function isCallMember(
  ctx: ReadCtx,
  callId: Id<"calls">,
  userId: string,
): Promise<boolean> {
  return (await findParticipant(ctx, callId, userId)) !== null;
}
