import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Counter rows deleted per prune run before rescheduling. */
const PRUNE_BATCH = 500;

/**
 * Retention for rate-limit counters. A row's `windowStart` is refreshed on
 * every hit that rolls the window over, so a counter whose window started a
 * week ago has not been touched by any configured window (the largest default
 * window is ten minutes) and can never be read again. Deleting it cannot affect
 * the rate-limit algorithm.
 */
export const RATE_LIMIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cron hook: drops rate-limit counters whose window is far past any possible
 * reset. Reads only rows older than the retention window via `by_window_start`
 * (never a full scan) and drains a backlog by rescheduling while a batch is
 * full. Rows inside the retention window are never touched.
 */
export const pruneRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RATE_LIMIT_RETENTION_MS;
    const rows = await ctx.db
      .query("rateLimits")
      .withIndex("by_window_start", (q) => q.lt("windowStart", cutoff))
      .take(PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.rateLimits.pruneRateLimits, {});
    }
    return rows.length;
  },
});
