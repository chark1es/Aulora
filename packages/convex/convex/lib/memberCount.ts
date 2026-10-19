import type { MutationCtx } from "../_generated/server";

/**
 * Adjusts the maintained member count on the singleton `server` row.
 *
 * A no-op when there is no server row or the count has not been backfilled
 * (`memberCount` is absent). In that state the license check falls back to a
 * member scan, so a missing field is the "not yet migrated" signal; inventing a
 * value from a delta would double-count. Once
 * {@link backfillMemberCount} has run, every add/remove keeps the field exact.
 */
export async function adjustMemberCount(ctx: MutationCtx, delta: number): Promise<void> {
  if (delta === 0) {
    return;
  }
  const server = await ctx.db.query("server").first();
  if (server === null || server.memberCount === undefined) {
    return;
  }
  await ctx.db.patch(server._id, { memberCount: Math.max(0, server.memberCount + delta) });
}
