import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireChannelAccess } from "./lib/channels";

/**
 * Counts plaintext `mentionUserIds` strictly after the read cursor, ignoring
 * deleted messages. The mention text itself stays encrypted; only the id list
 * is visible to the server by design.
 */
async function countMentionsAfter(
  ctx: Parameters<typeof requireChannelAccess>[0],
  channelId: Parameters<typeof requireChannelAccess>[1],
  userId: string,
  lastReadMessageId: string | undefined,
): Promise<number> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_channel_created", (q) => q.eq("channelId", channelId))
    .collect();
  let start = messages.length;
  if (lastReadMessageId !== undefined) {
    const index = messages.findIndex((message) => message._id === lastReadMessageId);
    start = index === -1 ? messages.length : index + 1;
  }
  return messages
    .slice(start)
    .filter((message) => message.deletedAt === undefined && message.mentionUserIds.includes(userId))
    .length;
}

/** Moves the read cursor for a channel and recomputes the mention count. */
export const set = mutation({
  args: {
    channelId: v.id("channels"),
    lastReadMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    if (args.lastReadMessageId !== undefined) {
      const cursor = await ctx.db.get(args.lastReadMessageId);
      if (cursor === null || cursor.channelId !== args.channelId) {
        throw new ConvexError("Cursor message not found in channel");
      }
    }
    const mentionCount = await countMentionsAfter(
      ctx,
      args.channelId,
      access.userId,
      args.lastReadMessageId,
    );
    const existing = await ctx.db
      .query("readStates")
      .withIndex("by_user_channel", (q) =>
        q.eq("userId", access.userId).eq("channelId", args.channelId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.insert("readStates", {
        userId: access.userId,
        channelId: args.channelId,
        mentionCount,
        ...(args.lastReadMessageId !== undefined
          ? { lastReadMessageId: args.lastReadMessageId }
          : {}),
      });
    } else {
      await ctx.db.patch(existing._id, {
        mentionCount,
        ...(args.lastReadMessageId !== undefined
          ? { lastReadMessageId: args.lastReadMessageId }
          : {}),
      });
    }
    return { lastReadMessageId: args.lastReadMessageId ?? null, mentionCount };
  },
});

/** Reads the caller's read state for a channel, or `null` when unset. */
export const get = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const state = await ctx.db
      .query("readStates")
      .withIndex("by_user_channel", (q) =>
        q.eq("userId", access.userId).eq("channelId", args.channelId),
      )
      .unique();
    if (state === null) {
      return null;
    }
    return {
      channelId: state.channelId,
      lastReadMessageId: state.lastReadMessageId ?? null,
      mentionCount: state.mentionCount,
    };
  },
});
