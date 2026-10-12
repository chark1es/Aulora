import { EVERYONE_ROLE_ID } from "@aulora/core";
import type { MutationCtx } from "../_generated/server";
import { assertNotBanned } from "./bans";

/**
 * Makes `userId` a member carrying `@everyone`. Refuses a banned account.
 * Returns `false` when they were already a member, so callers can leave
 * counters and audit rows alone on a repeat.
 */
export async function admitMember(ctx: MutationCtx, userId: string): Promise<boolean> {
  await assertNotBanned(ctx, userId);
  const existing = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing !== null) {
    return false;
  }
  await ctx.db.insert("members", {
    userId,
    roleIds: [EVERYONE_ROLE_ID],
    joinedAt: Date.now(),
  });
  return true;
}
