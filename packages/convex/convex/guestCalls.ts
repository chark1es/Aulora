import {
  GUEST_AFFILIATION_MAX,
  GUEST_LINK_DEFAULT_MAX_USES,
  GUEST_LINK_DEFAULT_TTL_MS,
  GUEST_LINK_LABEL_MAX,
  GUEST_LINK_MAX_TTL_MS,
  GUEST_LINK_MAX_USES,
  GUEST_LINK_SCHEDULED_GRACE_MS,
  GUEST_MAX_LINKS_PER_CALL,
  GUEST_MAX_LINKS_PER_CREATOR_PER_CALL,
  GUEST_MAX_PENDING_PER_LINK,
  GUEST_MAX_PER_CALL,
  GUEST_NAME_MAX,
  GUEST_PENDING_TTL_MS,
  GUEST_SESSION_MAX_TTL_MS,
  GUEST_SIGNAL_ACK_MAX,
  guestLinkUrl,
  hasPermission,
  normalizeGuestText,
  Permission,
  scheduledCallNotOpen,
  shouldOffer,
  transcriptionSpeakerKey,
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
import { assertMayParticipate, assertMayParticipateRead, mayParticipate } from "./lib/bans";
import {
  assertClientId,
  finishIfEmpty,
  insertGuestParticipant,
  loadCallSeats,
  MAX_CALL_SEATS,
  MAX_SIGNAL_BATCH,
  MAX_SIGNAL_BYTES,
  participantSignalKey,
  removeParticipant,
  syncAloneTimerForCall,
} from "./lib/calls";
import { requireChannelAccessForUser } from "./lib/channels";
import { randomToken, sha256Hex } from "./lib/crypto";
import { getTurnSettings } from "./lib/env";
import { loadEffectiveEnv } from "./lib/envOverrides";
import {
  findGuestSession,
  guestLinkError,
  linkIsUsable,
  newGuestLinkToken,
  newGuestSessionToken,
  openGuestIdentity,
  pendingCountForLink,
  requireGuestSession,
  requireUsableGuestLink,
  sealGuestIdentity,
} from "./lib/guestCalls";
import {
  loadPermissionContext,
  requireWorkspaceContext,
  workspacePermissions,
} from "./lib/permissions";
import { enforceRateLimit, requestIp } from "./lib/rateLimit";
import {
  liveCallOnChannel,
  requireScheduledCallVisible,
  resolveScheduledLiveCall,
} from "./lib/scheduledCalls";
import { openContent } from "./lib/sealed";
import { activeSessionForCall, authorizeTranscriptionSpeaker } from "./lib/transcription";
import { mintAudioToken as mintTranscriberToken } from "./lib/transcriptionToken";
import { buildTurnCredentials } from "./lib/turn";

/**
 * Guest calls (`api.guestCalls.*`).
 *
 * These are the ONLY functions a guest may call. They take an opaque guest
 * session token as an argument instead of a Convex identity, so a guest has
 * `ctx.auth === null` throughout. Every read and write is scoped to the one
 * call the guest was admitted to; member ids, channel names, files and chat are
 * never returned.
 */

const GUEST_JOIN_RATE_LIMIT = 10;
const GUEST_JOIN_GLOBAL_LIMIT = 60;
const GUEST_SIGNAL_RATE_LIMIT = 240;
const GUEST_RATE_WINDOW_MS = 60_000;

async function requireGuestAddon(ctx: QueryCtx | MutationCtx): Promise<void> {
  const server = await ctx.db.query("server").first();
  if (server?.settings.guestCallsEnabled !== true) {
    throw new ConvexError("Guest calls are disabled");
  }
}

async function currentCall(
  ctx: QueryCtx | MutationCtx,
  callId: Id<"calls"> | undefined,
): Promise<Doc<"calls"> | null> {
  if (callId === undefined) {
    return null;
  }
  const call = await ctx.db.get(callId);
  return call === null || call.status === "ended" ? null : call;
}

/** The live call a link points at, plus why it is not open when it is not. */
async function resolveGuestTarget(
  ctx: QueryCtx | MutationCtx,
  link: Doc<"callGuestLinks">,
): Promise<{
  readonly call: Doc<"calls"> | null;
  readonly scheduled: Doc<"scheduledCalls"> | null;
  readonly startsAt: number | null;
  readonly opensAt: number | null;
  readonly closed: boolean;
}> {
  // A scheduled link stays authoritative even when a channel-bound scheduled
  // call also stores its channel, so the open window and meeting title apply.
  if (link.scheduledCallId !== undefined) {
    const scheduled = await ctx.db.get(link.scheduledCallId);
    if (scheduled === null || scheduled.status === "cancelled" || scheduled.status === "ended") {
      return { call: null, scheduled, startsAt: null, opensAt: null, closed: true };
    }
    const opensAt = scheduled.startsAt - scheduled.openLeadMinutes * 60_000;
    // The same association rule as a member join: a channel room claimed by a
    // different scheduled meeting is never this link's target.
    const match = await resolveScheduledLiveCall(ctx, scheduled);
    return {
      call: match.call,
      scheduled,
      startsAt: scheduled.startsAt,
      opensAt,
      closed: false,
    };
  }
  if (link.channelId !== undefined) {
    return {
      call: await liveCallOnChannel(ctx, link.channelId),
      scheduled: null,
      startsAt: null,
      opensAt: null,
      closed: false,
    };
  }
  return { call: null, scheduled: null, startsAt: null, opensAt: null, closed: true };
}

/** A guest-facing call title. A channel name is not disclosed. */
async function targetTitle(
  ctx: QueryCtx | MutationCtx,
  link: Doc<"callGuestLinks">,
  scheduled: Doc<"scheduledCalls"> | null,
): Promise<string> {
  if (scheduled !== null) {
    return await openContent(
      { scope: "scheduledCall", recordId: scheduled._id },
      scheduled.titleCiphertext,
    );
  }
  void ctx;
  void link;
  return "Guest call";
}

/** Preview shown before a guest asks to join: title and open state only. */
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const link = await requireUsableGuestLink(ctx, args.token);
    const now = Date.now();
    const target = await resolveGuestTarget(ctx, link);
    if (target.closed) {
      throw guestLinkError();
    }
    const title = await targetTitle(ctx, link, target.scheduled);
    const open =
      target.call !== null && (target.scheduled === null || (target.opensAt ?? 0) <= now);
    return {
      title,
      open,
      startsAt: target.startsAt,
      opensAt: target.opensAt,
    };
  },
});

/**
 * Asks to join. Creates a pending lobby request and returns the guest session
 * token exactly once. The link token is never stored in plaintext.
 */
export const requestJoin = mutation({
  args: {
    token: v.string(),
    displayName: v.string(),
    affiliation: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const now = Date.now();
    const link = await requireUsableGuestLink(ctx, args.token, now);
    const displayName = normalizeGuestText(args.displayName);
    if (displayName.length === 0 || displayName.length > GUEST_NAME_MAX) {
      throw new ConvexError(`Display name must be 1–${GUEST_NAME_MAX} characters`);
    }
    const affiliation = normalizeGuestText(args.affiliation ?? "");
    if (affiliation.length > GUEST_AFFILIATION_MAX) {
      throw new ConvexError(`Affiliation must be at most ${GUEST_AFFILIATION_MAX} characters`);
    }
    const clientId = args.clientId === undefined ? undefined : assertClientId(args.clientId);
    if (clientId !== undefined) {
      const clientHash = await sha256Hex(clientId);
      if ((link.blockedClientHashes ?? []).includes(clientHash)) {
        throw guestLinkError();
      }
    }
    const ip = await requestIp(ctx);
    await enforceRateLimit(ctx, {
      key: `guest-join:link:${link.tokenHash}`,
      limit: GUEST_JOIN_RATE_LIMIT,
      windowMs: GUEST_RATE_WINDOW_MS,
    });
    await enforceRateLimit(ctx, {
      key: `guest-join:ip:${ip}`,
      limit: GUEST_JOIN_GLOBAL_LIMIT,
      windowMs: GUEST_RATE_WINDOW_MS,
    });
    const target = await resolveGuestTarget(ctx, link);
    if (target.closed) {
      throw guestLinkError();
    }
    if (target.scheduled !== null && target.opensAt !== null && now < target.opensAt) {
      throw new ConvexError(
        scheduledCallNotOpen(target.scheduled.startsAt, target.scheduled.openLeadMinutes),
      );
    }
    if (target.call === null) {
      throw new ConvexError("The call hasn't started yet");
    }
    if ((await pendingCountForLink(ctx, link._id)) >= GUEST_MAX_PENDING_PER_LINK) {
      throw new ConvexError("Too many people are waiting to join this call");
    }
    if (link.uses >= link.maxUses) {
      throw guestLinkError();
    }
    const sessionToken = newGuestSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAt = now + GUEST_PENDING_TTL_MS;
    const sessionId = await ctx.db.insert("callGuestSessions", {
      linkId: link._id,
      tokenHash,
      displayNameCiphertext: "",
      ...(affiliation.length > 0 ? { affiliationCiphertext: "" } : {}),
      status: "pending",
      requestedAt: now,
      callId: target.call._id,
      ...(clientId !== undefined ? { clientId } : {}),
      expiresAt,
    });
    await ctx.db.patch(
      sessionId,
      await sealGuestIdentity(sessionId, {
        displayName,
        affiliation: affiliation.length > 0 ? affiliation : null,
      }),
    );
    return {
      sessionToken,
      guestSessionId: sessionId,
      status: "pending" as const,
      expiresAt,
      callId: target.call._id,
    };
  },
});

/** The guest's own lobby/call state. */
export const lobby = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await findGuestSession(ctx, args.sessionToken);
    if (session === null) {
      throw guestLinkError();
    }
    await requireGuestAddon(ctx);
    const identity = await openGuestIdentity(session);
    // Do not wait for the hourly prune: an elapsed lobby request or 4-hour
    // session is already terminal for the guest page.
    const expired =
      session.expiresAt <= Date.now() &&
      (session.status === "pending" || session.status === "admitted");
    // A pending or admitted guest whose call has ended (or no longer resolves)
    // is terminal too. `left` is the existing status the guest page renders as
    // "The call has ended", so the lobby never waits on a dead call.
    let status = session.status;
    if (expired) {
      status = "expired" as const;
    } else if (session.status === "pending" || session.status === "admitted") {
      const call = session.callId !== undefined ? await ctx.db.get(session.callId) : null;
      if (session.callId === undefined || call === null || call.status === "ended") {
        status = "left" as const;
      }
    }
    return {
      guestSessionId: session._id,
      status,
      displayName: identity.displayName,
      affiliation: identity.affiliation,
      callId: session.callId ?? null,
      expiresAt: session.expiresAt,
    };
  },
});

export interface GuestRosterParticipant {
  readonly participantKey: string;
  readonly isGuest: boolean;
  readonly displayName: string;
  readonly muted: boolean;
  readonly video: boolean;
  readonly joinedAt: number;
  /** The seat generation. Peers ignore signalling from an older one. */
  readonly session: number;
  /**
   * Member rows only: true when the guest must create the offer toward this
   * member. It is the exact complement of `shouldOffer(memberAccountId,
   * guestSessionId)`, the rule every member client evaluates. Guest rows omit
   * it; guests elect among themselves by their guest session ids.
   */
  readonly shouldOffer?: boolean;
}

/** The reduced call roster a guest sees. Member ids are never returned. */
export const roster = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    const call = await currentCall(ctx, session.callId);
    if (call === null) {
      throw new ConvexError("This call has ended");
    }
    const rows = await loadCallSeats(ctx, call._id);
    const memberIds = rows.filter((row) => row.guestId === undefined).map((row) => row.userId);
    const names = await accountNames(ctx, memberIds);
    const participants: GuestRosterParticipant[] = [];
    for (const row of rows) {
      const isGuest = row.guestId !== undefined;
      const displayName = isGuest
        ? row.guestNameCiphertext === undefined
          ? "Guest"
          : await openGuestParticipantName(row)
        : (names.get(row.userId) ?? "Participant");
      participants.push({
        participantKey: guestParticipantKey(row),
        isGuest,
        displayName: displayName ?? "Participant",
        muted: row.muted,
        video: row.video,
        joinedAt: row.joinedAt,
        session: row.session ?? 0,
        // The member evaluates shouldOffer(M, G) where G is this guest's
        // session id. The guest takes the other half. Never expose M.
        ...(isGuest ? {} : { shouldOffer: !shouldOffer(row.userId, session._id) }),
      });
    }
    const active = await activeSessionForCall(ctx, call._id);
    const identity = await openGuestIdentity(session);
    return {
      guestSessionId: session._id,
      displayName: identity.displayName,
      affiliation: identity.affiliation,
      callId: call._id,
      callStatus: call.status,
      scheduledCallId: call.scheduledCallId ?? null,
      transcribing: active !== null,
      transcriptionSessionId: active?._id ?? null,
      participants,
    };
  },
});

async function openGuestParticipantName(row: Doc<"callParticipants">): Promise<string> {
  if (row.guestNameCiphertext === undefined) {
    return "Guest";
  }
  return await openContent(
    { scope: "callGuest.participant", recordId: row._id },
    row.guestNameCiphertext,
  );
}

/**
 * The key a guest uses for one roster row. A guest is addressed by its guest
 * session id (which is also the call engine's identity); a member is addressed
 * only by the opaque per-call `guestKey`, never by the account id.
 */
function guestParticipantKey(row: Doc<"callParticipants">): string {
  // Only signalling addresses use this key; offer election uses the roster's
  // `shouldOffer` bit instead.
  return participantSignalKey(row);
}

/** Resolves a guest's signalling target key to one participant row. */
function resolveParticipantKey(
  rows: readonly Doc<"callParticipants">[],
  participantKey: string,
): Doc<"callParticipants"> | null {
  return rows.find((row) => guestParticipantKey(row) === participantKey) ?? null;
}

/** Signals one participant of the guest's call. */
export const signal = mutation({
  args: {
    sessionToken: v.string(),
    toParticipantKey: v.string(),
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
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    const call = await currentCall(ctx, session.callId);
    if (call === null) {
      throw new ConvexError("This call has ended");
    }
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
    for (const payload of payloads) {
      if (payload.length > MAX_SIGNAL_BYTES) {
        throw new ConvexError("Signalling payload is too large");
      }
    }
    await enforceRateLimit(ctx, {
      key: `guest-signal:${session._id}`,
      limit: GUEST_SIGNAL_RATE_LIMIT,
      windowMs: GUEST_RATE_WINDOW_MS,
    });
    const rows = await loadCallSeats(ctx, call._id);
    const sender = rows.find((row) => row.guestId === session._id);
    if (sender === undefined) {
      throw new ConvexError("You are not in this call");
    }
    const receiver = resolveParticipantKey(rows, args.toParticipantKey);
    if (receiver === null || receiver._id === sender._id) {
      throw new ConvexError("Signalling target is not in this call");
    }
    const createdAt = Date.now();
    for (const payload of payloads) {
      await ctx.db.insert("callSignals", {
        callId: call._id,
        ...(call.channelId !== undefined ? { channelId: call.channelId } : {}),
        fromUserId: sender.userId,
        toUserId: receiver.userId,
        kind: args.kind,
        payload,
        session: sender.session ?? 0,
        createdAt,
      });
    }
    return null;
  },
});

/** Signalling rows addressed to the guest. */
export const signals = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    const rows = await ctx.db
      .query("callSignals")
      .withIndex("by_call_to", (q) =>
        q.eq("callId", session.callId as Id<"calls">).eq("toUserId", session._id),
      )
      .take(256);
    const call = await currentCall(ctx, session.callId);
    const participants = call === null ? [] : await loadCallSeats(ctx, call._id);
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((row) => {
        const sender = participants.find((row2) => row2.userId === row.fromUserId);
        // The sender's seat is gone. Never fall back to `row.fromUserId`: for a
        // member that is their account id, which a guest must never receive.
        if (sender === undefined) {
          return [];
        }
        return [
          {
            id: row._id,
            fromParticipantKey: guestParticipantKey(sender),
            kind: row.kind,
            payload: row.payload,
            session: row.session ?? 0,
            createdAt: row.createdAt,
          },
        ];
      });
  },
});

/** Acknowledges signalling rows the guest has processed. */
export const ack = mutation({
  args: { sessionToken: v.string(), signalIds: v.array(v.id("callSignals")) },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    if (args.signalIds.length > GUEST_SIGNAL_ACK_MAX) {
      throw new ConvexError("Too many signalling acknowledgements");
    }
    await enforceRateLimit(ctx, {
      key: `guest-ack:${session._id}`,
      limit: GUEST_SIGNAL_RATE_LIMIT,
      windowMs: GUEST_RATE_WINDOW_MS,
    });
    for (const id of args.signalIds) {
      const row = await ctx.db.get(id);
      if (row !== null && row.toUserId === session._id) {
        await ctx.db.delete(id);
      }
    }
    return null;
  },
});

/** Updates the guest's own mute/camera flags. No screen sharing in v1. */
export const updateParticipant = mutation({
  args: {
    sessionToken: v.string(),
    muted: v.optional(v.boolean()),
    video: v.optional(v.boolean()),
    sharingScreen: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    if (args.sharingScreen === true) {
      throw new ConvexError("Guests cannot share their screen");
    }
    const session = await requireGuestSession(ctx, args.sessionToken);
    const call = await currentCall(ctx, session.callId);
    if (call === null) {
      throw new ConvexError("This call has ended");
    }
    const rows = await loadCallSeats(ctx, call._id);
    const row = rows.find((entry) => entry.guestId === session._id);
    if (row === undefined) {
      throw new ConvexError("You are not in this call");
    }
    await ctx.db.patch(row._id, {
      ...(args.muted !== undefined ? { muted: args.muted } : {}),
      ...(args.video !== undefined ? { video: args.video } : {}),
      lastSeen: Date.now(),
    });
    return null;
  },
});

/**
 * A short-lived TURN credential for an admitted guest, so a guest behind a
 * strict NAT can reach the members the same way a member can. `null` when the
 * deployment has no relay. The username is bound to the guest session, never to
 * an account.
 */
export const turnCredentials = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    if (session.status !== "admitted") {
      // A guest still in the lobby gets no relay access.
      throw guestLinkError();
    }
    const call = await currentCall(ctx, session.callId);
    if (call === null) {
      throw new ConvexError("This call has ended");
    }
    const settings = getTurnSettings((await loadEffectiveEnv(ctx)).env);
    if (settings === null) {
      return null;
    }
    return await buildTurnCredentials({ settings, userId: `guest:${session._id}` });
  },
});

/** Keeps the guest's seat and session fresh. */
export const heartbeat = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    const now = Date.now();
    const call = await currentCall(ctx, session.callId);
    if (call !== null) {
      const rows = await loadCallSeats(ctx, call._id);
      const row = rows.find((entry) => entry.guestId === session._id);
      if (row !== undefined) {
        await ctx.db.patch(row._id, { lastSeen: now });
      }
    }
    await ctx.db.patch(session._id, { lastSeen: now });
    return { expiresAt: session.expiresAt };
  },
});

/** Leaves the call; the last participant out ends it. */
export const leave = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await findGuestSession(ctx, args.sessionToken);
    if (session === null) {
      return null;
    }
    if (session.callId !== undefined) {
      const call = await ctx.db.get(session.callId);
      if (call !== null) {
        const rows = await loadCallSeats(ctx, call._id);
        const row = rows.find((entry) => entry.guestId === session._id);
        if (row !== undefined) {
          await removeParticipant(ctx, call, row.userId);
        }
        await finishIfEmpty(ctx, call._id);
        // A fresh solo window for the host still present, not the stale one
        // from before the guest was admitted.
        await syncAloneTimerForCall(ctx, call._id);
      }
    }
    if (session.status === "admitted" || session.status === "pending") {
      await ctx.db.patch(session._id, { status: "left", expiresAt: Date.now() });
    }
    return null;
  },
});

/** Mints a transcription audio token bound to this guest session. */
export const mintAudioToken = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const session = await requireGuestSession(ctx, args.sessionToken);
    const call = await currentCall(ctx, session.callId);
    if (call === null) {
      throw new ConvexError("This call has ended");
    }
    const server = await ctx.db.query("server").first();
    if (server?.settings.transcriptionEnabled !== true) {
      throw new ConvexError("Transcription is disabled");
    }
    const active = await activeSessionForCall(ctx, call._id);
    if (active === null) {
      throw new ConvexError("Transcription is not running in this call");
    }
    const secret = process.env.TRANSCRIBER_TOKEN;
    if (secret === undefined || secret.length === 0) {
      throw new ConvexError("Transcription service not installed");
    }
    const speakerKey = transcriptionSpeakerKey("guest", session._id);
    await authorizeTranscriptionSpeaker(ctx, active._id, speakerKey);
    const minted = await mintTranscriberToken(secret, {
      sid: active._id,
      cid: call._id,
      sub: speakerKey,
      start: active.startedAt,
    });
    return {
      token: minted.token,
      expiresAt: minted.expiresAt,
      sessionId: active._id,
      wsPath: "/transcribe/",
    };
  },
});

/** Bounded read of a target's currently active links (unrevoked, unexpired). */
async function activeLinksForTarget(
  ctx: QueryCtx | MutationCtx,
  target: { readonly channelId?: Id<"channels">; readonly scheduledCallId?: Id<"scheduledCalls"> },
  now: number,
): Promise<Doc<"callGuestLinks">[]> {
  if (target.scheduledCallId !== undefined) {
    return await ctx.db
      .query("callGuestLinks")
      .withIndex("by_scheduled_active", (q) =>
        q
          .eq("scheduledCallId", target.scheduledCallId)
          .eq("revokedAt", undefined)
          .gt("expiresAt", now),
      )
      .take(GUEST_MAX_LINKS_PER_CALL);
  }
  if (target.channelId !== undefined) {
    return await ctx.db
      .query("callGuestLinks")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", target.channelId).eq("revokedAt", undefined).gt("expiresAt", now),
      )
      .take(GUEST_MAX_LINKS_PER_CALL);
  }
  return [];
}

/**
 * Whether the caller has lobby duties for a call: `ManageGuestAccess`, or being
 * the creator of one of the call's links while seated in that call.
 */
async function isLobbyManager(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  call: Doc<"calls">,
  link?: Doc<"callGuestLinks">,
): Promise<boolean> {
  const context = await loadPermissionContext(ctx, userId);
  if (hasPermission(workspacePermissions(context), Permission.ManageGuestAccess)) {
    return true;
  }
  const seats = await loadCallSeats(ctx, call._id);
  const seated = seats.some((row) => row.userId === userId && row.guestId === undefined);
  if (!seated) {
    return false;
  }
  if (link !== undefined && link.createdBy === userId) {
    return true;
  }
  const links = await ctx.db
    .query("callGuestLinks")
    .withIndex("by_creator_created", (q) => q.eq("createdBy", userId))
    .order("desc")
    .take(GUEST_MAX_LINKS_PER_CALL * 2);
  return links.some(
    (row) =>
      row.revokedAt === undefined &&
      ((call.channelId !== undefined && row.channelId === call.channelId) ||
        (call.scheduledCallId !== undefined && row.scheduledCallId === call.scheduledCallId)),
  );
}

/** Members with lobby duties; see {@link isLobbyManager}. */
async function requireLobbyManager(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  call: Doc<"calls">,
  link?: Doc<"callGuestLinks">,
): Promise<void> {
  if (!(await isLobbyManager(ctx, userId, call, link))) {
    throw new ConvexError("Missing guest-access permission");
  }
}

/**
 * Whether the caller may see and answer the lobby of a call. The UI uses this
 * to decide whether to subscribe to the lobby list, so an ordinary participant
 * never triggers a permission error. Never throws for a missing permission.
 */
export const lobbyAccess = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const server = await ctx.db.query("server").first();
    if (server?.settings.guestCallsEnabled !== true) {
      return { canManage: false };
    }
    if (!(await mayParticipate(ctx, userId))) {
      return { canManage: false };
    }
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status === "ended") {
      return { canManage: false };
    }
    return { canManage: await isLobbyManager(ctx, userId, call) };
  },
});

/** Whether the viewer may manage every link for a scheduled call. */
async function isScheduledLinksManager(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  scheduled: Doc<"scheduledCalls">,
): Promise<boolean> {
  const context = await loadPermissionContext(ctx, userId);
  const permissions = workspacePermissions(context);
  if (
    hasPermission(permissions, Permission.ManageGuestAccess) ||
    hasPermission(permissions, Permission.ManageScheduledCalls) ||
    scheduled.createdBy === userId
  ) {
    return true;
  }
  if (scheduled.callId !== undefined) {
    const call = await currentCall(ctx, scheduled.callId);
    if (call !== null && (await isLobbyManager(ctx, userId, call))) {
      return true;
    }
  }
  return false;
}

function mergeLinkRows(
  ...lists: readonly (readonly Doc<"callGuestLinks">[])[]
): Doc<"callGuestLinks">[] {
  const seen = new Map<string, Doc<"callGuestLinks">>();
  for (const list of lists) {
    for (const row of list) {
      seen.set(row._id, row);
    }
  }
  return [...seen.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Lists guest links without their plaintext tokens. Accepts exactly one of a
 * live `callId` (the in-call dialog) or a `scheduledCallId` (the Scheduled
 * tab), so links created for a scheduled call can be revoked before it opens.
 */
export const links = query({
  args: {
    callId: v.optional(v.id("calls")),
    scheduledCallId: v.optional(v.id("scheduledCalls")),
  },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireAuth(ctx);
    await assertMayParticipateRead(ctx, userId);
    if ((args.callId === undefined) === (args.scheduledCallId === undefined)) {
      throw new ConvexError("Choose a call or a scheduled call");
    }
    let scheduledId: Id<"scheduledCalls"> | undefined = args.scheduledCallId;
    let channelId: Id<"channels"> | undefined;
    let manageAll = true;
    if (args.callId !== undefined) {
      const call = await ctx.db.get(args.callId);
      if (call === null) {
        return [];
      }
      await requireLobbyManager(ctx, userId, call);
      scheduledId = call.scheduledCallId;
      channelId = call.channelId;
    } else {
      const scheduled = await ctx.db.get(args.scheduledCallId as Id<"scheduledCalls">);
      if (scheduled === null) {
        return [];
      }
      // A CreateGuestLinks invitee may create a link before the room is live,
      // so they must also be able to find and revoke their own links without a
      // manager permission. Managers still see every link for the call.
      manageAll = await isScheduledLinksManager(ctx, userId, scheduled);
      scheduledId = scheduled._id;
      channelId = scheduled.channelId;
    }
    const rows: Doc<"callGuestLinks">[] = [];
    if (scheduledId !== undefined) {
      rows.push(
        ...(await ctx.db
          .query("callGuestLinks")
          .withIndex("by_scheduled_created", (q) => q.eq("scheduledCallId", scheduledId))
          .order("desc")
          .take(GUEST_MAX_LINKS_PER_CALL)),
      );
    }
    if (channelId !== undefined) {
      rows.push(
        ...(await ctx.db
          .query("callGuestLinks")
          .withIndex("by_channel_created", (q) => q.eq("channelId", channelId))
          .order("desc")
          .take(GUEST_MAX_LINKS_PER_CALL)),
      );
    }
    return mergeLinkRows(rows)
      .filter((row) => manageAll || row.createdBy === userId)
      .map((row) => ({
        id: row._id,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        maxUses: row.maxUses,
        uses: row.uses,
        revoked: row.revokedAt !== undefined,
        label: row.label ?? null,
      }));
  },
});

/** Creates a guest link. The plaintext token is returned exactly once. */
export const createLink = mutation({
  args: {
    channelId: v.optional(v.id("channels")),
    scheduledCallId: v.optional(v.id("scheduledCalls")),
    label: v.optional(v.string()),
    expiresInMs: v.optional(v.number()),
    maxUses: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireWorkspaceContext(ctx, Permission.CreateGuestLinks);
    await assertMayParticipate(ctx, userId);
    if ((args.channelId === undefined) === (args.scheduledCallId === undefined)) {
      throw new ConvexError("Choose a channel call or a scheduled call");
    }
    const now = Date.now();
    const label = args.label?.trim() ?? "";
    if (label.length > GUEST_LINK_LABEL_MAX) {
      throw new ConvexError(`Label must be at most ${GUEST_LINK_LABEL_MAX} characters`);
    }
    const maxUses = Math.min(
      GUEST_LINK_MAX_USES,
      Math.max(1, Math.trunc(args.maxUses ?? GUEST_LINK_DEFAULT_MAX_USES)),
    );
    let expiresAt =
      now +
      Math.min(
        GUEST_LINK_MAX_TTL_MS,
        Math.max(60_000, Math.trunc(args.expiresInMs ?? GUEST_LINK_DEFAULT_TTL_MS)),
      );
    if (args.channelId !== undefined) {
      await requireChannelAccessForUser(ctx, userId, args.channelId, Permission.Connect);
      const existing = await activeLinksForTarget(ctx, { channelId: args.channelId }, now);
      if (existing.length >= GUEST_MAX_LINKS_PER_CALL) {
        throw new ConvexError("This call has too many active guest links");
      }
      const mine = existing.filter((row) => row.createdBy === userId);
      if (mine.length >= GUEST_MAX_LINKS_PER_CREATOR_PER_CALL) {
        throw new ConvexError("You have too many active guest links for this call");
      }
    } else {
      const scheduled = await ctx.db.get(args.scheduledCallId as Id<"scheduledCalls">);
      if (scheduled === null) {
        throw new ConvexError("Scheduled call not found");
      }
      if (scheduled.status === "cancelled" || scheduled.status === "ended") {
        throw new ConvexError("This scheduled call has ended");
      }
      await requireScheduledCallVisible(ctx, userId, scheduled);
      const endAt =
        scheduled.startsAt +
        (scheduled.durationMinutes ?? 240) * 60_000 +
        GUEST_LINK_SCHEDULED_GRACE_MS;
      if (endAt <= now) {
        throw new ConvexError("This scheduled call has ended");
      }
      expiresAt = Math.min(expiresAt, endAt);
      const existing = await activeLinksForTarget(
        ctx,
        {
          ...(scheduled.channelId !== undefined ? { channelId: scheduled.channelId } : {}),
          scheduledCallId: scheduled._id,
        },
        now,
      );
      if (existing.length >= GUEST_MAX_LINKS_PER_CALL) {
        throw new ConvexError("This call has too many active guest links");
      }
      const mine = existing.filter((row) => row.createdBy === userId);
      if (mine.length >= GUEST_MAX_LINKS_PER_CREATOR_PER_CALL) {
        throw new ConvexError("You have too many active guest links for this call");
      }
    }
    const token = newGuestLinkToken();
    const tokenHash = await sha256Hex(token);
    const scheduledTarget =
      args.scheduledCallId !== undefined
        ? await ctx.db.get(args.scheduledCallId as Id<"scheduledCalls">)
        : null;
    const storedChannelId =
      args.channelId ?? (scheduledTarget !== null ? scheduledTarget.channelId : undefined);
    const linkId = await ctx.db.insert("callGuestLinks", {
      tokenHash,
      ...(storedChannelId !== undefined ? { channelId: storedChannelId } : {}),
      ...(args.scheduledCallId !== undefined ? { scheduledCallId: args.scheduledCallId } : {}),
      createdBy: userId,
      createdAt: now,
      expiresAt,
      maxUses,
      uses: 0,
      ...(label.length > 0 ? { label } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "guestCall.createLink",
      targetId: linkId,
      meta: JSON.stringify({ maxUses, expiresAt }),
    });
    const siteUrl = process.env.SITE_URL ?? "";
    return {
      linkId,
      token,
      url: guestLinkUrl(siteUrl, token),
      expiresAt,
      maxUses,
    };
  },
});

/** Revokes a guest link. The creator or `ManageGuestAccess` may do it. */
export const revokeLink = mutation({
  args: { linkId: v.id("callGuestLinks") },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireAuth(ctx);
    await assertMayParticipate(ctx, userId);
    const link = await ctx.db.get(args.linkId);
    if (link === null) {
      return null;
    }
    const context = await loadPermissionContext(ctx, userId);
    const permissions = workspacePermissions(context);
    const canManage = hasPermission(permissions, Permission.ManageGuestAccess);
    // The link's creator may revoke it while they still hold CreateGuestLinks;
    // `assertMayParticipate` above already rejects banned/timed-out callers.
    const own =
      link.createdBy === userId && hasPermission(permissions, Permission.CreateGuestLinks);
    if (!canManage && !own) {
      throw new ConvexError("You cannot revoke this link");
    }
    if (link.revokedAt === undefined) {
      await ctx.db.patch(link._id, { revokedAt: Date.now() });
      await writeAudit(ctx, {
        actorId: userId,
        action: "guestCall.revokeLink",
        targetId: link._id,
      });
    }
    return null;
  },
});

async function guestSessionCall(
  ctx: MutationCtx | QueryCtx,
  session: Doc<"callGuestSessions">,
): Promise<Doc<"calls">> {
  const current = await currentCall(ctx, session.callId);
  if (current !== null) {
    return current;
  }
  // A pending request may not have a call row yet (the host has not joined the
  // scheduled window). Resolve the link's current target instead.
  const link = await ctx.db.get(session.linkId);
  if (link === null) {
    throw new ConvexError("This call has ended");
  }
  const target = await resolveGuestTarget(ctx, link);
  if (target.call === null) {
    throw new ConvexError("This call has ended");
  }
  return target.call;
}

/** Pending and admitted guests for the in-call lobby prompt. */
export const lobbyList = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireAuth(ctx);
    await assertMayParticipateRead(ctx, userId);
    const call = await ctx.db.get(args.callId);
    if (call === null) {
      return { pending: [], admitted: [] };
    }
    await requireLobbyManager(ctx, userId, call);
    const now = Date.now();
    // Query the two statuses separately through the status index. Taking a
    // fixed prefix of all sessions let old denied/removed rows hide new work.
    const pendingRows = await ctx.db
      .query("callGuestSessions")
      .withIndex("by_call_status", (q) => q.eq("callId", args.callId).eq("status", "pending"))
      .take(GUEST_MAX_PENDING_PER_LINK * GUEST_MAX_LINKS_PER_CALL);
    const admittedRows = await ctx.db
      .query("callGuestSessions")
      .withIndex("by_call_status", (q) => q.eq("callId", args.callId).eq("status", "admitted"))
      .take(GUEST_MAX_PER_CALL + 8);
    const pendingViews = [];
    for (const session of pendingRows) {
      if (session.expiresAt <= now) {
        continue;
      }
      const identity = await openGuestIdentity(session);
      pendingViews.push({
        guestSessionId: session._id,
        displayName: identity.displayName,
        affiliation: identity.affiliation,
        requestedAt: session.requestedAt,
        expiresAt: session.expiresAt,
      });
    }
    const admittedViews = [];
    for (const session of admittedRows) {
      if (session.expiresAt <= now) {
        continue;
      }
      const identity = await openGuestIdentity(session);
      admittedViews.push({
        guestSessionId: session._id,
        displayName: identity.displayName,
        affiliation: identity.affiliation,
        admittedAt: session.admittedAt ?? null,
        expiresAt: session.expiresAt,
      });
    }
    return { pending: pendingViews, admitted: admittedViews };
  },
});

/** Admits a waiting guest. */
export const admit = mutation({
  args: { guestSessionId: v.id("callGuestSessions") },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.guestSessionId);
    if (session === null || session.status !== "pending" || session.expiresAt <= Date.now()) {
      throw new ConvexError("This request is no longer waiting");
    }
    const link = await ctx.db.get(session.linkId);
    if (link === null || !linkIsUsable(link)) {
      throw guestLinkError();
    }
    const call = await guestSessionCall(ctx, session);
    await requireLobbyManager(ctx, userId, call, link);
    await assertMayParticipate(ctx, userId);
    if (link.uses >= link.maxUses) {
      throw guestLinkError();
    }
    // A pending request can go stale while another scheduled meeting claims
    // the same unassociated channel room. Never admit it into a room that now
    // belongs to a different scheduled call.
    if (
      link.scheduledCallId !== undefined &&
      call.scheduledCallId !== undefined &&
      call.scheduledCallId !== link.scheduledCallId
    ) {
      throw guestLinkError();
    }
    // Claim an unassociated live channel room for this scheduled meeting, so a
    // second scheduled link cannot enter the same room.
    if (link.scheduledCallId !== undefined && call.scheduledCallId === undefined) {
      const scheduled = await ctx.db.get(link.scheduledCallId);
      if (
        scheduled !== null &&
        scheduled.channelId !== undefined &&
        call.channelId === scheduled.channelId
      ) {
        await ctx.db.patch(call._id, {
          scheduledCallId: scheduled._id,
          updatedAt: Date.now(),
        });
        await ctx.db.patch(scheduled._id, {
          callId: call._id,
          ...(scheduled.status === "scheduled" ? { status: "open" as const } : {}),
          updatedAt: Date.now(),
        });
      }
    }
    const now = Date.now();
    const admitted = await ctx.db
      .query("callGuestSessions")
      .withIndex("by_call_status", (q) => q.eq("callId", call._id).eq("status", "admitted"))
      .take(64);
    if (admitted.filter((row) => row.expiresAt > now).length >= GUEST_MAX_PER_CALL) {
      throw new ConvexError("This call already has the maximum number of guests");
    }
    // Guest-facing views must never fall back to a member account id. Current
    // rows already have a `guestKey`; backfill only legacy rows, bounded by the
    // call seat cap.
    for (const row of await loadCallSeats(ctx, call._id)) {
      if (row.guestId === undefined && row.guestKey === undefined) {
        await ctx.db.patch(row._id, { guestKey: randomToken(16) });
      }
    }
    const seats = await loadCallSeats(ctx, call._id);
    const server = await ctx.db.query("server").first();
    const maxParticipants = server?.settings.maxCallParticipants ?? 10;
    if (seats.length >= maxParticipants) {
      throw new ConvexError("This call is full");
    }
    if (seats.length >= MAX_CALL_SEATS) {
      throw new ConvexError("This call is full");
    }
    if (seats.some((row) => row.guestId === session._id)) {
      return null;
    }
    const identity = await openGuestIdentity(session);
    const expiresAt = now + GUEST_SESSION_MAX_TTL_MS;
    await insertGuestParticipant(
      ctx,
      call,
      session._id,
      identity.displayName,
      session.clientId ?? randomToken(16),
    );
    await ctx.db.patch(session._id, {
      status: "admitted",
      callId: call._id,
      admittedAt: now,
      admittedBy: userId,
      expiresAt,
      lastSeen: now,
    });
    if (call.status === "ringing") {
      // Same rule as `calls.join`: a ringing DM call answered by an admitted
      // guest becomes active so the solo-call sweep does not end it.
      await ctx.db.patch(call._id, {
        status: "active",
        ringingUserIds: [],
        updatedAt: now,
      });
    }
    // A guest is a distinct participant, so a host no longer alone clears the
    // solo deadline here instead of waiting for the sweep.
    await syncAloneTimerForCall(ctx, call._id);
    await ctx.db.patch(link._id, { uses: link.uses + 1 });
    await writeAudit(ctx, {
      actorId: userId,
      action: "guestCall.admit",
      targetId: session._id,
      meta: JSON.stringify({ callId: call._id }),
    });
    return { callId: call._id, expiresAt };
  },
});

/** Denies a waiting guest. */
export const deny = mutation({
  args: { guestSessionId: v.id("callGuestSessions") },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.guestSessionId);
    if (session === null || session.status !== "pending") {
      return null;
    }
    const link = await ctx.db.get(session.linkId);
    if (link === null) {
      return null;
    }
    const call = await guestSessionCall(ctx, session);
    await requireLobbyManager(ctx, userId, call, link);
    await assertMayParticipate(ctx, userId);
    await ctx.db.patch(session._id, {
      status: "denied",
      deniedAt: Date.now(),
      expiresAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "guestCall.deny",
      targetId: session._id,
    });
    return null;
  },
});

/** Removes an admitted guest and blocks their client id from that link. */
export const remove = mutation({
  args: { guestSessionId: v.id("callGuestSessions") },
  handler: async (ctx, args) => {
    await requireGuestAddon(ctx);
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.guestSessionId);
    if (session === null) {
      return null;
    }
    const link = await ctx.db.get(session.linkId);
    if (link === null) {
      return null;
    }
    const call = await guestSessionCall(ctx, session);
    await requireLobbyManager(ctx, userId, call, link);
    await assertMayParticipate(ctx, userId);
    if (session.callId !== undefined) {
      const rows = await loadCallSeats(ctx, call._id);
      const row = rows.find((entry) => entry.guestId === session._id);
      if (row !== undefined) {
        // A moderator removal has no departure grace.
        await removeParticipant(ctx, call, row.userId, { blocked: true });
        await syncAloneTimerForCall(ctx, call._id);
      }
    }
    await ctx.db.patch(session._id, {
      status: "removed",
      removedAt: Date.now(),
      expiresAt: Date.now(),
    });
    if (session.clientId !== undefined) {
      const clientHash = await sha256Hex(session.clientId);
      const blocked = link.blockedClientHashes ?? [];
      if (!blocked.includes(clientHash) && blocked.length < 50) {
        await ctx.db.patch(link._id, { blockedClientHashes: [...blocked, clientHash] });
      }
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "guestCall.remove",
      targetId: session._id,
    });
    return null;
  },
});

/** Drops expired lobby requests and ended guest sessions in bounded batches. */
export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("callGuestSessions")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(50);
    for (const session of expired) {
      if (session.status === "admitted" || session.status === "pending") {
        await ctx.db.patch(session._id, {
          status: session.status === "admitted" ? "left" : "expired",
          expiresAt: now,
        });
      } else {
        await ctx.db.delete(session._id);
      }
    }
    if (expired.length >= 50) {
      await ctx.scheduler.runAfter(0, internal.guestCalls.pruneExpired, {});
    }
    return null;
  },
});

/** Expired or exhausted links stay as audit history; the query hides them. */
