import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireChannelAccess, requireChannelAccessFromContext } from "./lib/channels";
import { loadPermissionContext, type PermissionContext } from "./lib/permissions";

/**
 * Counts plaintext `mentionUserIds` strictly after the read cursor, ignoring
 * deleted messages. The mention text itself stays encrypted; only the id list
 * is visible to the server by design. The tail is read as a `by_channel_created`
 * index range starting after the cursor's `_creationTime` and truncated at
 * {@link MENTION_SCAN_LIMIT}, so the count saturates instead of collecting the
 * whole channel history.
 */
async function countMentionsAfter(
  ctx: Parameters<typeof requireChannelAccess>[0],
  channelId: Parameters<typeof requireChannelAccess>[1],
  userId: string,
  lastReadMessageId: string | undefined,
): Promise<number> {
  let cursorAt: number | null = null;
  if (lastReadMessageId !== undefined) {
    const cursor = await ctx.db.get(lastReadMessageId as Id<"messages">);
    // A cursor that no longer resolves in this channel reads as fully read,
    // matching the previous positional `findIndex === -1` behaviour.
    if (cursor === null || cursor.channelId !== channelId) {
      return 0;
    }
    cursorAt = cursor._creationTime;
  }
  let mentions = 0;
  let lower = cursorAt;
  for (let pageIndex = 0; pageIndex < MENTION_SCAN_PAGES; pageIndex += 1) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel_created", (q) => {
        const base = q.eq("channelId", channelId);
        return lower === null ? base : base.gt("_creationTime", lower);
      })
      .take(MENTION_SCAN_LIMIT);
    mentions += messages.filter(
      (message) => message.deletedAt === undefined && message.mentionUserIds.includes(userId),
    ).length;
    mentions = Math.min(mentions, MENTION_SCAN_LIMIT);
    const last = messages.at(-1);
    if (
      last === undefined ||
      messages.length < MENTION_SCAN_LIMIT ||
      mentions >= MENTION_SCAN_LIMIT
    ) {
      break;
    }
    lower = last._creationTime;
  }
  return mentions;
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
/** Pages examined when the bounded tail contains no qualifying message. */
const MENTION_SCAN_PAGES = 5;

/** Upper bound on channels per summary call, matching the sidebar page size. */
const SUMMARY_CHANNEL_LIMIT = 200;
/** Pages examined when a channel's tail contains only excluded messages. */
const SUMMARY_SCAN_PAGES = 5;

interface ChannelUnreadSummary {
  channelId: Id<"channels">;
  unread: boolean;
  mentionCount: number;
  lastActivityAt: number | null;
  lastAuthorId: string | null;
}

/** Computes one channel's live unread/mention summary for a single viewer. */
async function summarizeChannel(
  ctx: Parameters<typeof requireChannelAccess>[0],
  channelId: Id<"channels">,
  userId: string,
): Promise<ChannelUnreadSummary> {
  const latest = await ctx.db
    .query("messages")
    .withIndex("by_channel_thread", (q) =>
      q.eq("channelId", channelId).eq("threadRootId", undefined),
    )
    .order("desc")
    .first();
  const state = await ctx.db
    .query("readStates")
    .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
    .unique();
  const cursor =
    state?.lastReadMessageId !== undefined ? await ctx.db.get(state.lastReadMessageId) : null;
  const cursorAt = cursor?._creationTime ?? null;

  let upper: number | null = null;
  let unread = false;
  let mentionCount = 0;
  for (let pageIndex = 0; pageIndex < SUMMARY_SCAN_PAGES; pageIndex += 1) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel_created", (q) => {
        const base = q.eq("channelId", channelId);
        if (cursorAt !== null && upper !== null) {
          return base.gt("_creationTime", cursorAt).lt("_creationTime", upper);
        }
        if (cursorAt !== null) {
          return base.gt("_creationTime", cursorAt);
        }
        if (upper !== null) {
          return base.lt("_creationTime", upper);
        }
        return base;
      })
      .order("desc")
      .take(MENTION_SCAN_LIMIT);
    for (const message of messages) {
      if (
        message.authorId === userId ||
        message.deletedAt !== undefined ||
        message.threadRootId !== undefined
      ) {
        continue;
      }
      unread = true;
      if (message.mentionUserIds.includes(userId)) {
        mentionCount = Math.min(mentionCount + 1, MENTION_SCAN_LIMIT);
      }
    }
    const last = messages.at(-1);
    if (
      last === undefined ||
      messages.length < MENTION_SCAN_LIMIT ||
      mentionCount >= MENTION_SCAN_LIMIT
    ) {
      break;
    }
    // Continue past a run of the viewer's own messages: an older page may
    // still contain unread messages or mentions from other people.
    upper = last._creationTime;
  }

  return {
    channelId,
    unread,
    mentionCount,
    lastActivityAt: latest?._creationTime ?? null,
    lastAuthorId: latest?.authorId ?? null,
  };
}

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
    let context: PermissionContext;
    try {
      const { userId } = await requireAuth(ctx);
      context = await loadPermissionContext(ctx, userId);
    } catch {
      return [];
    }
    const rows: ChannelUnreadSummary[] = [];
    for (const channelId of args.channelIds.slice(0, SUMMARY_CHANNEL_LIMIT)) {
      try {
        await requireChannelAccessFromContext(ctx, context, channelId, Permission.ViewChannel);
      } catch {
        continue;
      }
      rows.push(await summarizeChannel(ctx, channelId, context.userId));
    }
    return rows;
  },
});
