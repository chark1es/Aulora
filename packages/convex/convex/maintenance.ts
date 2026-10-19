import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Members processed per backfill page before rescheduling. */
const MEMBER_BACKFILL_BATCH = 500;

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
