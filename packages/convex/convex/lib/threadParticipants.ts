import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface ThreadParticipantInput {
  readonly userId: string;
  readonly threadRootId: Id<"messages">;
  readonly channelId: Id<"channels">;
  /** Creation time of the reply (or mention) being recorded. */
  readonly at: number;
  readonly mentioned: boolean;
  /** True when this write is a reply, not just a mention. */
  readonly participated: boolean;
}

/**
 * Upserts a user's participation row for one thread root. `lastReplyAt` only
 * moves forward and `mentioned` only ever becomes true, so repeated replies and
 * mentions are idempotent. No-op rows are not rewritten.
 */
export async function upsertThreadParticipant(
  ctx: MutationCtx,
  input: ThreadParticipantInput,
): Promise<void> {
  const existing = await ctx.db
    .query("threadParticipants")
    .withIndex("by_thread_user", (q) =>
      q.eq("threadRootId", input.threadRootId).eq("userId", input.userId),
    )
    .unique();
  if (existing === null) {
    await ctx.db.insert("threadParticipants", {
      userId: input.userId,
      threadRootId: input.threadRootId,
      channelId: input.channelId,
      lastReplyAt: input.at,
      mentioned: input.mentioned,
      participated: input.participated,
    });
    return;
  }
  const lastReplyAt = Math.max(existing.lastReplyAt, input.at);
  const mentioned = existing.mentioned || input.mentioned;
  const participated = existing.participated === true || input.participated;
  if (
    lastReplyAt !== existing.lastReplyAt ||
    mentioned !== existing.mentioned ||
    participated !== (existing.participated === true) ||
    existing.channelId !== input.channelId
  ) {
    await ctx.db.patch(existing._id, {
      lastReplyAt,
      mentioned,
      participated,
      channelId: input.channelId,
    });
  }
}
