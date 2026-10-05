import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { requireChannelAccess } from "./channels";
import { isDmKind } from "./channels";
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

export type ReadCtx = Parameters<typeof requireChannelAccess>[0];

export interface CallParticipantSummary {
  readonly userId: string;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
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
export async function loadParticipants(
  ctx: ReadCtx,
  callId: Id<"calls">,
  viewerId: string,
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
      clientId: row.userId === viewerId ? (row.clientId ?? null) : null,
      session: row.session ?? 0,
      speaking: false,
      audioLevel: 0,
      connection: "connected" as const,
    }));
}

export async function toCallSummary(
  ctx: ReadCtx,
  call: Doc<"calls">,
  viewerId: string,
): Promise<CallSummary> {
  return {
    id: call._id,
    channelId: call.channelId,
    kind: call.kind,
    status: call.status,
    initiatorId: call.initiatorId,
    ringingUserIds: call.ringingUserIds,
    screenShareUserId: call.screenShareUserId ?? null,
    startedAt: call.startedAt,
    participants: await loadParticipants(ctx, call._id, viewerId),
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
export async function endCall(ctx: MutationCtx, call: Doc<"calls">): Promise<void> {
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
  channelId: Id<"channels">,
  userId: string,
  clientId: string,
): Promise<void> {
  const now = Date.now();
  await ctx.db.insert("callParticipants", {
    callId,
    channelId,
    userId,
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
    readonly channelId: Id<"channels">;
    readonly kind: "voice" | "video";
    readonly clientId: string;
    readonly ringingUserIds?: readonly string[];
  },
  channel: Doc<"channels">,
  userId: string,
): Promise<{ callId: Id<"calls">; ringing: boolean }> {
  const ringingUserIds = await ringingTargets(ctx, channel, userId, args.ringingUserIds);
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
): Promise<void> {
  const other = await ctx.db.get(row.callId);
  if (other !== null && other.status !== "ended") {
    await removeParticipant(ctx, other, userId);
    await finishIfEmpty(ctx, other._id);
  } else {
    await ctx.db.delete(row._id);
  }
}

/**
 * A user is in one call, from one device. The same device switching calls
 * drops the previous seat. A different device must pass `takeover`, which
 * disconnects the other one. Returns whether this call already had a seat
 * for the user (so the caller must not insert a second row).
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
): Promise<"present" | "absent"> {
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
  for (const row of rows) {
    if (target !== null && row.callId === target._id) {
      await claimSeat(ctx, row, target, args.userId, clientId);
    } else {
      await evictStaleSeat(ctx, row, args.userId);
    }
  }
  return here === undefined ? "absent" : "present";
}

/** Internal helper kept for feature parity with the other domain modules. */
export async function isCallMember(
  ctx: ReadCtx,
  callId: Id<"calls">,
  userId: string,
): Promise<boolean> {
  return (await findParticipant(ctx, callId, userId)) !== null;
}
