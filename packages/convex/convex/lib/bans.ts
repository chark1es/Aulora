import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** A ban with no `expiresAt` is permanent; a past expiry is no longer a ban. */
export function banIsActive(ban: Doc<"bans">, now: number = Date.now()): boolean {
  return ban.expiresAt === undefined || ban.expiresAt > now;
}

/** The caller's still-active ban rows, if any. */
export async function listActiveBans(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<"bans">[]> {
  const now = Date.now();
  const rows = await ctx.db
    .query("bans")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.filter((row) => banIsActive(row, now));
}

/**
 * Deletes every expired ban row for `userId` and reports whether an active ban
 * remains. Mutations use this so a lapsed temp ban leaves no residue.
 */
export async function pruneExpiredBans(ctx: MutationCtx, userId: string): Promise<boolean> {
  const now = Date.now();
  const rows = await ctx.db
    .query("bans")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let active = false;
  for (const row of rows) {
    if (row.expiresAt !== undefined && row.expiresAt <= now) {
      await ctx.db.delete(row._id);
    } else {
      active = true;
    }
  }
  return active;
}

/** Throws when `userId` is actively banned, pruning expired rows on the way. */
export async function assertNotBanned(ctx: MutationCtx, userId: string): Promise<void> {
  if (await pruneExpiredBans(ctx, userId)) {
    throw new ConvexError("You are banned from this workspace");
  }
}

/**
 * The single "may participate" gate for writes (send, react, type, upload,
 * call, join). Rejects an active ban and an unexpired `timeoutUntil`.
 *
 * A ban normally removes the `members` row so the membership gate already
 * rejects it; the explicit ban check here is defence in depth for a ban row
 * that outlived its member row. Timeout is a members-row field, so it is
 * checked here rather than in the membership gate — a timed-out member can
 * still read, but cannot participate.
 */
export async function assertMayParticipate(ctx: MutationCtx, userId: string): Promise<void> {
  await assertNotBanned(ctx, userId);
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (member !== null && member.timeoutUntil !== undefined && member.timeoutUntil > Date.now()) {
    throw new ConvexError("You are timed out and cannot participate");
  }
}
