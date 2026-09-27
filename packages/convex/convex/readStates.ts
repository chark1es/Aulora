import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
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
    // Never move the cursor backwards: a stale client (or a second device)
    // reporting an older message must not resurrect already-read messages.
    if (existing?.lastReadMessageId !== undefined && args.lastReadMessageId !== undefined) {
      const current = await ctx.db.get(existing.lastReadMessageId);
      const incoming = await ctx.db.get(args.lastReadMessageId);
      if (current !== null && incoming !== null && incoming._creationTime < current._creationTime) {
        return {
          lastReadMessageId: existing.lastReadMessageId,
          mentionCount: existing.mentionCount,
        };
      }
    }
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

/** Upper bound on mentions counted per channel; the badge shows "99+" anyway. */
const MENTION_SCAN_LIMIT = 200;

/** Upper bound on channels per summary call, matching the sidebar page size. */
const SUMMARY_CHANNEL_LIMIT = 200;

/**
 * Live unread summary for the sidebar: for each requested channel the caller
 * can view, whether it has unread root messages from other people, how many of
 * those mention the caller, and when it last had activity. Mentions are
 * counted live from plaintext `mentionUserIds` rather than the cached count on
 * the read state, so new mentions show up without the client moving its
 * cursor. Channels the caller cannot view are omitted, never an error.
 */
export const summary = query({
  args: { channelIds: v.array(v.id("channels")) },
  handler: async (ctx, args) => {
    const rows: {
      channelId: Id<"channels">;
      unread: boolean;
      mentionCount: number;
      lastActivityAt: number | null;
      lastAuthorId: string | null;
    }[] = [];
    for (const channelId of args.channelIds.slice(0, SUMMARY_CHANNEL_LIMIT)) {
      let userId: string;
      try {
        ({ userId } = await requireChannelAccess(ctx, channelId, Permission.ViewChannel));
      } catch {
        continue;
      }
      const latest = await ctx.db
        .query("messages")
        .withIndex("by_channel_created", (q) => q.eq("channelId", channelId))
        .filter((q) => q.eq(q.field("threadRootId"), undefined))
        .order("desc")
        .first();
      const state = await ctx.db
        .query("readStates")
        .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
        .unique();
      const cursor =
        state?.lastReadMessageId !== undefined ? await ctx.db.get(state.lastReadMessageId) : null;
      const cursorAt = cursor?._creationTime ?? null;

      const after = await ctx.db
        .query("messages")
        .withIndex("by_channel_created", (q) =>
          cursorAt === null
            ? q.eq("channelId", channelId)
            : q.eq("channelId", channelId).gt("_creationTime", cursorAt),
        )
        .order("desc")
        .take(MENTION_SCAN_LIMIT);
      const fromOthers = after.filter(
        (message) =>
          message.authorId !== userId &&
          message.deletedAt === undefined &&
          message.threadRootId === undefined,
      );
      const mentionCount = fromOthers.filter((message) =>
        message.mentionUserIds.includes(userId),
      ).length;

      rows.push({
        channelId,
        unread: fromOthers.length > 0,
        mentionCount,
        lastActivityAt: latest?._creationTime ?? null,
        lastAuthorId: latest?.authorId ?? null,
      });
    }
    return rows;
  },
});
