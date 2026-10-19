import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { syncMemberRoles } from "./lib/memberRoles";
import { upsertThreadParticipant } from "./lib/threadParticipants";

/** Members processed per backfill page before rescheduling. */
const MEMBER_BACKFILL_BATCH = 500;
/** Members whose role links are synced per backfill page. */
const MEMBER_ROLE_BACKFILL_BATCH = 200;
/** Messages scanned per thread-participant backfill page. */
const THREAD_PARTICIPANT_BACKFILL_BATCH = 200;

/**
 * Idempotent migration: recount `members` and store the total on the singleton
 * `server` row so the license seat/MAU check no longer has to read up to 100k
 * member rows every 30 minutes. Safe to re-run at any time: a run started with
 * no cursor recounts from zero and overwrites an existing value. Pages through
 * members and reschedules while more remain.
 */
export const backfillMemberCount = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    counted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server === null) {
      return null;
    }
    const page = await ctx.db
      .query("members")
      .paginate({ numItems: MEMBER_BACKFILL_BATCH, cursor: args.cursor ?? null });
    const counted = (args.counted ?? 0) + page.page.length;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillMemberCount, {
        cursor: page.continueCursor,
        counted,
      });
      return null;
    }
    await ctx.db.patch(server._id, { memberCount: counted });
    return null;
  },
});

/**
 * Idempotent migration: seeds the `memberRoles` reverse index from
 * `members.roleIds`, which stays authoritative for reads. Safe to re-run; each
 * run rewrites the links for the members it pages over. Reschedules while more
 * members remain.
 */
export const backfillMemberRoles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("members")
      .paginate({ numItems: MEMBER_ROLE_BACKFILL_BATCH, cursor: args.cursor ?? null });
    for (const member of page.page) {
      await syncMemberRoles(ctx, member.userId, member.roleIds, member.joinedAt);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillMemberRoles, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/**
 * Idempotent migration: seeds `threadParticipants` from existing thread roots'
 * `replyParticipantIds` and `mentionUserIds`. Paged over `messages` and
 * rescheduled while more remain, so it never scans the whole table in one
 * transaction. Safe to re-run: the upsert only moves `lastReplyAt` forward and
 * ORs `mentioned`.
 */
export const backfillThreadParticipants = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("messages")
      .paginate({ numItems: THREAD_PARTICIPANT_BACKFILL_BATCH, cursor: args.cursor ?? null });
    for (const message of page.page) {
      // Only thread roots carry `replyParticipantIds`; replies are covered when
      // their root is processed (and by live writes going forward).
      if (message.threadRootId !== undefined) {
        continue;
      }
      const at = message.lastReplyAt ?? message._creationTime;
      for (const userId of message.replyParticipantIds ?? []) {
        await upsertThreadParticipant(ctx, {
          userId,
          threadRootId: message._id,
          channelId: message.channelId,
          at,
          mentioned: false,
        });
      }
      for (const userId of message.mentionUserIds) {
        await upsertThreadParticipant(ctx, {
          userId,
          threadRootId: message._id,
          channelId: message.channelId,
          at: message._creationTime,
          mentioned: true,
        });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillThreadParticipants, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
