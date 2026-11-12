import {
  GUEST_LINK_GENERIC_ERROR,
  GUEST_LINK_TOKEN_PREFIX,
  GUEST_SESSION_TOKEN_PREFIX,
  GUEST_TOKEN_BYTES,
  isWellFormedGuestToken,
} from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { randomToken, sha256Hex } from "./crypto";
import { openContent } from "./sealed";
import { sealString } from "./sse";

/**
 * Shared helpers for guest links, the lobby and guest sessions.
 *
 * A guest has no Convex identity. The only credential is an opaque session
 * token whose SHA-256 digest is stored; every `guestCalls.*` function resolves
 * it to exactly one session row and then scopes every read and write to that
 * session's call.
 */

type ReadCtx = QueryCtx | MutationCtx;

/** A fresh link token, shown once. */
export function newGuestLinkToken(): string {
  return `${GUEST_LINK_TOKEN_PREFIX}${randomToken(GUEST_TOKEN_BYTES)}`;
}

/** A fresh guest session token, shown once. */
export function newGuestSessionToken(): string {
  return `${GUEST_SESSION_TOKEN_PREFIX}${randomToken(GUEST_TOKEN_BYTES)}`;
}

/** Stores only the digest; the plaintext never touches the database. */
export async function guestTokenHash(token: string): Promise<string> {
  return await sha256Hex(token);
}

function tokenShapeLooksValid(token: string, prefix: string): boolean {
  return isWellFormedGuestToken(token, prefix);
}

/** Resolves a link by token, or `null` for any unusable/malformed value. */
export async function findGuestLink(
  ctx: ReadCtx,
  token: string,
): Promise<Doc<"callGuestLinks"> | null> {
  if (!tokenShapeLooksValid(token, GUEST_LINK_TOKEN_PREFIX)) {
    return null;
  }
  const hash = await guestTokenHash(token);
  return await ctx.db
    .query("callGuestLinks")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
    .unique();
}

/** The one generic error every unusable link returns. */
export function guestLinkError(): ConvexError<string> {
  return new ConvexError(GUEST_LINK_GENERIC_ERROR);
}

/** A link is usable when it is not revoked, expired or exhausted. */
export function linkIsUsable(link: Doc<"callGuestLinks">, now: number = Date.now()): boolean {
  return link.revokedAt === undefined && link.expiresAt > now && link.uses < link.maxUses;
}

/** Resolves a usable link or throws the generic error. */
export async function requireUsableGuestLink(
  ctx: ReadCtx,
  token: string,
  now: number = Date.now(),
): Promise<Doc<"callGuestLinks">> {
  const link = await findGuestLink(ctx, token);
  if (link === null || !linkIsUsable(link, now)) {
    throw guestLinkError();
  }
  return link;
}

/** Resolves a guest session by token, or `null`. */
export async function findGuestSession(
  ctx: ReadCtx,
  token: string,
): Promise<Doc<"callGuestSessions"> | null> {
  if (!tokenShapeLooksValid(token, GUEST_SESSION_TOKEN_PREFIX)) {
    return null;
  }
  const hash = await guestTokenHash(token);
  return await ctx.db
    .query("callGuestSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
    .unique();
}

/** A session token is live only while the row is admitted and unexpired. */
export function guestSessionIsLive(
  session: Doc<"callGuestSessions">,
  now: number = Date.now(),
): boolean {
  return session.status === "admitted" && session.expiresAt > now;
}

/** Resolves an admitted, unexpired guest session or throws the generic error. */
export async function requireGuestSession(
  ctx: ReadCtx,
  token: string,
  now: number = Date.now(),
): Promise<Doc<"callGuestSessions">> {
  const session = await findGuestSession(ctx, token);
  if (session === null || !guestSessionIsLive(session, now)) {
    throw guestLinkError();
  }
  return session;
}

export interface GuestIdentity {
  readonly displayName: string;
  readonly affiliation: string | null;
}

/** Seals the guest-supplied name and affiliation under the session row. */
export async function sealGuestIdentity(
  sessionId: Id<"callGuestSessions">,
  identity: GuestIdentity,
): Promise<{ displayNameCiphertext: string; affiliationCiphertext?: string }> {
  const context = { scope: "callGuest.identity", recordId: sessionId };
  return {
    displayNameCiphertext: await sealString(context, identity.displayName),
    ...(identity.affiliation !== null
      ? { affiliationCiphertext: await sealString(context, identity.affiliation) }
      : {}),
  };
}

/** Opens a guest session's name and affiliation for a member-facing view. */
export async function openGuestIdentity(session: Doc<"callGuestSessions">): Promise<GuestIdentity> {
  const context = { scope: "callGuest.identity", recordId: session._id };
  return {
    displayName: await openContent(context, session.displayNameCiphertext),
    affiliation:
      session.affiliationCiphertext === undefined
        ? null
        : await openContent(context, session.affiliationCiphertext),
  };
}

/** Seals a display-name snapshot stored on a participant row. */
export async function sealGuestParticipantName(
  participantId: string,
  displayName: string,
): Promise<string> {
  return await sealString({ scope: "callGuest.participant", recordId: participantId }, displayName);
}

/** Opens a participant row's sealed guest name. */
export async function openGuestParticipantName(
  participant: Doc<"callParticipants">,
): Promise<string | null> {
  if (participant.guestNameCiphertext === undefined) {
    return null;
  }
  return await openContent(
    { scope: "callGuest.participant", recordId: participant._id },
    participant.guestNameCiphertext,
  );
}

/** Marks every admitted guest session on a call as left when the call ends. */
export async function endGuestSessionsForCall(
  ctx: MutationCtx,
  callId: Id<"calls">,
  now: number = Date.now(),
): Promise<void> {
  const admitted = await ctx.db
    .query("callGuestSessions")
    .withIndex("by_call_status", (q) => q.eq("callId", callId).eq("status", "admitted"))
    .take(64);
  for (const session of admitted) {
    await ctx.db.patch(session._id, { status: "left", expiresAt: now });
  }
}

/** Counts pending requests for a link, bounded by the pending cap. */
export async function pendingCountForLink(
  ctx: ReadCtx,
  linkId: Id<"callGuestLinks">,
  now: number = Date.now(),
): Promise<number> {
  const rows = await ctx.db
    .query("callGuestSessions")
    .withIndex("by_link_status", (q) => q.eq("linkId", linkId).eq("status", "pending"))
    .take(64);
  return rows.filter((row) => row.expiresAt > now).length;
}
