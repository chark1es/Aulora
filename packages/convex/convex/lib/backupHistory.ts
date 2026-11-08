import type { QueryCtx } from "../_generated/server";

/** Cron intents do not represent runner activity; retain manual requests. */
export function backupHistory(ctx: QueryCtx) {
  return ctx.db
    .query("backups")
    .withIndex("by_started")
    .order("desc")
    .filter((q) => q.or(q.neq(q.field("trigger"), "cron"), q.neq(q.field("status"), "requested")));
}
