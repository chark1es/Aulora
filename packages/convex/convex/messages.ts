import { hasPermission, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import { requireChannelAccess } from "./lib/channels";
import { recordLicenseActivity } from "./lib/licenseActivity";
import { requireMember } from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";
import { loadThreadInbox, type ThreadInboxRow } from "./lib/threadInbox";
import type { Nullable } from "./lib/types";

/** Per-user send budget: 30 messages per 10 seconds unless overridden. */
function sendLimit(): number {
  const configured = Number(process.env.SEND_RATE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

function sendWindowMs(): number {
  const configured = Number(process.env.SEND_RATE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

/** SSE scope and record id binding a message body to its channel. */
function messageContext(channelId: Id<"channels">) {
  return { scope: "message", recordId: channelId as string };
}

interface MessageView {
  readonly id: Id<"messages">;
  readonly channelId: Id<"channels">;
  readonly authorId: string;
  readonly body: string;
  readonly threadRootId: Nullable<Id<"messages">>;
  readonly replyToId: Nullable<Id<"messages">>;
  readonly attachmentIds: Id<"files">[];
  readonly mentionUserIds: string[];
  readonly mentionChannelIds: string[];
  readonly mentionCategoryIds: string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly pinnedAt: number | null;
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  readonly createdAt: number;
}

async function toMessage(message: Doc<"messages">): Promise<MessageView> {
  return {
    id: message._id,
    channelId: message.channelId,
    authorId: message.authorId,
    body: await openContent(messageContext(message.channelId), message.ciphertext),
    threadRootId: message.threadRootId ?? null,
    replyToId: message.replyToId ?? null,
    attachmentIds: message.attachmentIds,
    mentionUserIds: message.mentionUserIds,
    mentionChannelIds: message.mentionChannelIds ?? [],
    mentionCategoryIds: message.mentionCategoryIds ?? [],
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
    pinnedAt: message.pinnedAt ?? null,
    replyCount: message.replyCount ?? 0,
    lastReplyAt: message.lastReplyAt ?? null,
    createdAt: message._creationTime,
  };
}

async function toMessages(messages: readonly Doc<"messages">[]): Promise<MessageView[]> {
  return await Promise.all(messages.map(toMessage));
}

/**
 * Drops mention ids that do not resolve: a stored mention must point at a real
 * member, channel or category, so a client can never route a notification wake
 * to an arbitrary string. Unknown ids are filtered rather than stored.
 */
async function filterMentionIds(
  ctx: Parameters<typeof requireChannelAccess>[0],
  mentionUserIds: readonly string[],
  mentionChannelIds: readonly string[],
  mentionCategoryIds: readonly string[],
): Promise<{
  mentionUserIds: string[];
  mentionChannelIds: string[];
  mentionCategoryIds: string[];
}> {
  const users: string[] = [];
  for (const userId of new Set(mentionUserIds)) {
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (member !== null) {
      users.push(userId);
    }
  }
  const channels: string[] = [];
  for (const channelId of new Set(mentionChannelIds)) {
    try {
      if ((await ctx.db.get(channelId as Id<"channels">)) !== null) {
        channels.push(channelId);
      }
    } catch {
      // A malformed id is not a known channel; drop it.
    }
  }
  const categories: string[] = [];
  for (const categoryId of new Set(mentionCategoryIds)) {
    try {
      if ((await ctx.db.get(categoryId as Id<"categories">)) !== null) {
        categories.push(categoryId);
      }
    } catch {
      // A malformed id is not a known category; drop it.
    }
  }
  return {
    mentionUserIds: users,
    mentionChannelIds: channels,
    mentionCategoryIds: categories,
  };
}

/** Validates and returns the thread root a reply targets, or `null`. */
async function resolveThreadRoot(
  ctx: Parameters<typeof requireChannelAccess>[0],
  channelId: Id<"channels">,
  permissions: bigint,
  threadRootId?: Id<"messages">,
): Promise<Nullable<Doc<"messages">>> {
  if (threadRootId === undefined) {
    return null;
  }
  if (!hasPermission(permissions, Permission.SendInThreads)) {
    throw new ConvexError("Missing permission");
  }
  const threadRoot = await ctx.db.get(threadRootId);
  if (threadRoot === null || threadRoot.channelId !== channelId) {
    throw new ConvexError("Thread root not found in channel");
  }
  if (threadRoot.threadRootId !== undefined) {
    throw new ConvexError("Threads cannot be nested");
  }
  if ((threadRoot.replyCount ?? 0) === 0 && !hasPermission(permissions, Permission.CreateThreads)) {
    throw new ConvexError("Missing permission to create threads");
  }
  return threadRoot;
}

/** Ensures a reply target, when present, belongs to the same channel. */
async function assertReplyTarget(
  ctx: Parameters<typeof requireChannelAccess>[0],
  channelId: Id<"channels">,
  replyToId?: Id<"messages">,
): Promise<void> {
  if (replyToId === undefined) {
    return;
  }
  const replyTo = await ctx.db.get(replyToId);
  if (replyTo === null || replyTo.channelId !== channelId) {
    throw new ConvexError("Reply target not found in channel");
  }
}

/** Sends a message: the server seals the plaintext body before storing it. */
export const send = mutation({
  args: {
    channelId: v.id("channels"),
    body: v.string(),
    threadRootId: v.optional(v.id("messages")),
    replyToId: v.optional(v.id("messages")),
    attachmentIds: v.optional(v.array(v.id("files"))),
    mentionUserIds: v.optional(v.array(v.string())),
    mentionChannelIds: v.optional(v.array(v.string())),
    mentionCategoryIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.SendMessages);
    await assertMayParticipate(ctx, access.userId);
    const threadRoot = await resolveThreadRoot(
      ctx,
      args.channelId,
      access.permissions,
      args.threadRootId,
    );
    await assertReplyTarget(ctx, args.channelId, args.replyToId);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("send", access.userId),
      limit: sendLimit(),
      windowMs: sendWindowMs(),
    });
    const mentions = await filterMentionIds(
      ctx,
      args.mentionUserIds ?? [],
      args.mentionChannelIds ?? [],
      args.mentionCategoryIds ?? [],
    );
    const ciphertext = await sealString(messageContext(args.channelId), args.body);
    const messageId = await ctx.db.insert("messages", {
      channelId: args.channelId,
      authorId: access.userId,
      ciphertext,
      attachmentIds: args.attachmentIds ?? [],
      mentionUserIds: mentions.mentionUserIds,
      mentionChannelIds: mentions.mentionChannelIds,
      mentionCategoryIds: mentions.mentionCategoryIds,
      ...(args.threadRootId !== undefined ? { threadRootId: args.threadRootId } : {}),
      ...(args.replyToId !== undefined ? { replyToId: args.replyToId } : {}),
    });
    if (threadRoot !== null) {
      const reply = await ctx.db.get(messageId);
      await ctx.db.patch(threadRoot._id, {
        replyCount: (threadRoot.replyCount ?? 0) + 1,
        lastReplyAt: reply?._creationTime ?? Date.now(),
      });
    }
    // Burst behavior: every message enqueues two zero-delay jobs (web push and
    // mobile push), so a burst of thousands of messages enqueues two jobs per
    // message. `notifications.ts` has no safe coalescing helper — each dispatch
    // resolves recipients and targets per message and swallows delivery when the
    // transport is unconfigured — so we intentionally leave the two independent
    // jobs rather than invent one. The cost is scheduler fan-out, not delivery
    // semantics.
    //
    // Resolve recipients and send content-free Web Push wakes asynchronously;
    // the action no-ops when VAPID is not configured.
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchForMessage, { messageId });
    // Route content-free mobile wakes (APNs/FCM/UnifiedPush) via the push relay;
    // also a no-op when the relay is unconfigured.
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchMobileForMessage, { messageId });
    await recordLicenseActivity(ctx, access.userId);
    return messageId;
  },
});

/**
 * Paginated channel timeline. Pages walk backwards from the newest message, so
 * the first page is always the live tail and `continueCursor` loads older
 * history; each page is returned oldest first for rendering. Thread replies are
 * filtered before pagination so they never crowd roots out of a page; use
 * {@link listThread} for replies. Deleted messages are returned with
 * `deletedAt` set so clients render a tombstone.
 */
export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ReadHistory);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", args.channelId).eq("threadRootId", undefined),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: (await toMessages(result.page)).reverse() };
  },
});

/** History around a search result or pin, including results outside the live tail. */
export const context = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) return null;
    await requireChannelAccess(ctx, message.channelId, Permission.ReadHistory);
    if (message.deletedAt !== undefined) return null;
    const root =
      message.threadRootId === undefined ? message : await ctx.db.get(message.threadRootId);
    if (root === null || root.deletedAt !== undefined) return null;
    const [before, after] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_channel_thread", (q) =>
          q
            .eq("channelId", root.channelId)
            .eq("threadRootId", undefined)
            .lt("_creationTime", root._creationTime),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("messages")
        .withIndex("by_channel_thread", (q) =>
          q
            .eq("channelId", root.channelId)
            .eq("threadRootId", undefined)
            .gt("_creationTime", root._creationTime),
        )
        .order("asc")
        .take(20),
    ]);
    const history = await toMessages([...before.reverse(), root, ...after]);
    return { message: await toMessage(message), root: await toMessage(root), history };
  },
});

/** Paginated thread replies for one root message, oldest first. */
export const listThread = query({
  args: { threadRootId: v.id("messages"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const root = await ctx.db.get(args.threadRootId);
    if (root === null) {
      throw new ConvexError("Thread root not found");
    }
    await requireChannelAccess(ctx, root.channelId, Permission.ReadHistory);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadRootId", args.threadRootId))
      .order("asc")
      .paginate(args.paginationOpts);
    return { ...result, page: await toMessages(result.page) };
  },
});

/** Edits a message (re-sealing the body): the author, or anyone with ManageMessages. */
export const edit = mutation({
  args: {
    messageId: v.id("messages"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new ConvexError("Message not found");
    }
    const access = await requireChannelAccess(ctx, message.channelId, Permission.ViewChannel);
    const isAuthor = message.authorId === access.userId;
    if (!isAuthor && !hasPermission(access.permissions, Permission.ManageMessages)) {
      throw new ConvexError("Missing permission");
    }
    const ciphertext = await sealString(messageContext(message.channelId), args.body);
    await ctx.db.patch(args.messageId, { ciphertext, editedAt: Date.now() });
    // A moderator editing someone else's message is a moderation act worth an
    // audit row; the author editing their own message is routine.
    if (!isAuthor) {
      await writeAudit(ctx, {
        actorId: access.userId,
        action: "message.edit",
        targetId: args.messageId,
        meta: JSON.stringify({ authorId: message.authorId }),
      });
    }
    return null;
  },
});

/** Soft-deletes a message: the author, or anyone with `ManageMessages`. */
export const remove = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new ConvexError("Message not found");
    }
    const access = await requireChannelAccess(ctx, message.channelId, Permission.ViewChannel);
    const isAuthor = message.authorId === access.userId;
    if (!isAuthor && !hasPermission(access.permissions, Permission.ManageMessages)) {
      throw new ConvexError("Missing permission");
    }
    if (message.deletedAt === undefined) {
      await ctx.db.patch(args.messageId, { deletedAt: Date.now() });
    }
    // A moderator deleting someone else's message is a moderation act; a
    // self-delete stays out of the audit log.
    if (!isAuthor) {
      await writeAudit(ctx, {
        actorId: access.userId,
        action: "message.delete",
        targetId: args.messageId,
        meta: JSON.stringify({ authorId: message.authorId }),
      });
    }
    return null;
  },
});

/** Pins a message. Requires `PinMessages`. */
export const pin = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new ConvexError("Message not found");
    }
    await requireChannelAccess(ctx, message.channelId, Permission.PinMessages);
    if (message.pinnedAt === undefined) {
      await ctx.db.patch(args.messageId, { pinnedAt: Date.now() });
    }
    return null;
  },
});

/** Unpins a message. Requires `PinMessages`. */
export const unpin = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new ConvexError("Message not found");
    }
    await requireChannelAccess(ctx, message.channelId, Permission.PinMessages);
    if (message.pinnedAt !== undefined) {
      await ctx.db.patch(args.messageId, { pinnedAt: undefined });
    }
    return null;
  },
});

/** Paginated pinned messages for a channel, newest pin first. */
export const listPins = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ReadHistory);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_channel_pinned", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .paginate(args.paginationOpts);
    const pinned = result.page.filter((message) => message.pinnedAt !== undefined);
    return { ...result, page: await toMessages(pinned) };
  },
});

/** One row of the Threads inbox, with its root body opened server-side. */
export type { ThreadInboxRow } from "./lib/threadInbox";

/**
 * Powers the "Threads" inbox: the threads the signed-in viewer participated in
 * by posting a reply to the root, or was mentioned in (a mention anywhere in the
 * root or any reply counts). Participation is reply-only — authoring the root
 * alone does not add the viewer.
 *
 * Without a dedicated per-user index this scans the newest `messages` and groups
 * replies by `threadRootId`, which fits small workspaces. Bodies are opened
 * server-side so the client always receives plaintext, never ciphertext.
 */
export const threadInbox = query({
  args: {},
  handler: async (ctx): Promise<ThreadInboxRow[]> => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    return await loadThreadInbox(ctx, userId);
  },
});
