import { hasPermission, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireChannelAccess } from "./lib/channels";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";

/** Per-user send budget: 30 messages per 10 seconds unless overridden. */
function sendLimit(): number {
  const configured = Number(process.env.SEND_RATE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

function sendWindowMs(): number {
  const configured = Number(process.env.SEND_RATE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

interface MessageView {
  readonly id: Id<"messages">;
  readonly channelId: Id<"channels">;
  readonly authorId: string;
  readonly authorDeviceId: Id<"devices"> | null;
  readonly ciphertext: string;
  readonly epoch: number;
  readonly threadRootId: Id<"messages"> | null;
  readonly attachmentIds: Id<"files">[];
  readonly mentionUserIds: string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly pinnedAt: number | null;
  readonly createdAt: number;
}

function toMessage(message: Doc<"messages">): MessageView {
  return {
    id: message._id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorDeviceId: message.authorDeviceId ?? null,
    ciphertext: message.ciphertext,
    epoch: message.epoch,
    threadRootId: message.threadRootId ?? null,
    attachmentIds: message.attachmentIds,
    mentionUserIds: message.mentionUserIds,
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
    pinnedAt: message.pinnedAt ?? null,
    createdAt: message._creationTime,
  };
}

/**
 * Sends an encrypted message. Requires `SendMessages`, plus `SendInThreads`
 * when replying in a thread. The server stores the ciphertext verbatim.
 */
export const send = mutation({
  args: {
    channelId: v.id("channels"),
    ciphertext: v.string(),
    epoch: v.number(),
    threadRootId: v.optional(v.id("messages")),
    attachmentIds: v.optional(v.array(v.id("files"))),
    mentionUserIds: v.optional(v.array(v.string())),
    authorDeviceId: v.optional(v.id("devices")),
  },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.SendMessages);
    if (args.threadRootId !== undefined) {
      if (!hasPermission(access.permissions, Permission.SendInThreads)) {
        throw new ConvexError("Missing permission");
      }
      const root = await ctx.db.get(args.threadRootId);
      if (root === null || root.channelId !== args.channelId) {
        throw new ConvexError("Thread root not found in channel");
      }
    }
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("send", access.userId),
      limit: sendLimit(),
      windowMs: sendWindowMs(),
    });
    const messageId = await ctx.db.insert("messages", {
      channelId: args.channelId,
      authorId: access.userId,
      ciphertext: args.ciphertext,
      epoch: args.epoch,
      attachmentIds: args.attachmentIds ?? [],
      mentionUserIds: args.mentionUserIds ?? [],
      ...(args.threadRootId !== undefined ? { threadRootId: args.threadRootId } : {}),
      ...(args.authorDeviceId !== undefined ? { authorDeviceId: args.authorDeviceId } : {}),
    });
    // Resolve recipients and send content-free Web Push wakes asynchronously;
    // the action no-ops when VAPID is not configured.
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchForMessage, { messageId });
    // Route content-free mobile wakes (APNs/FCM/UnifiedPush) via the push relay;
    // also a no-op when the relay is unconfigured.
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchMobileForMessage, { messageId });
    return messageId;
  },
});

/**
 * Paginated channel timeline, oldest first. Thread replies are excluded so the
 * main view shows only roots; use {@link listThread} for replies. Deleted
 * messages are returned with `deletedAt` set so clients render a tombstone.
 */
export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ReadHistory);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_channel_created", (q) => q.eq("channelId", args.channelId))
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.filter((m) => m.threadRootId === undefined).map(toMessage),
    };
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
    return { ...result, page: result.page.map(toMessage) };
  },
});

/** Edits a message: the author, or anyone with `ManageMessages`. */
export const edit = mutation({
  args: {
    messageId: v.id("messages"),
    ciphertext: v.string(),
    epoch: v.optional(v.number()),
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
    await ctx.db.patch(args.messageId, {
      ciphertext: args.ciphertext,
      editedAt: Date.now(),
      ...(args.epoch !== undefined ? { epoch: args.epoch } : {}),
    });
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
      await writeAudit(ctx, {
        actorId: access.userId,
        action: "message.delete",
        targetId: args.messageId,
        meta: JSON.stringify({ channelId: message.channelId }),
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
    const access = await requireChannelAccess(ctx, message.channelId, Permission.PinMessages);
    if (message.pinnedAt === undefined) {
      await ctx.db.patch(args.messageId, { pinnedAt: Date.now() });
      await writeAudit(ctx, {
        actorId: access.userId,
        action: "message.pin",
        targetId: args.messageId,
        meta: JSON.stringify({ channelId: message.channelId }),
      });
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
    const access = await requireChannelAccess(ctx, message.channelId, Permission.PinMessages);
    if (message.pinnedAt !== undefined) {
      await ctx.db.patch(args.messageId, { pinnedAt: undefined });
      await writeAudit(ctx, {
        actorId: access.userId,
        action: "message.unpin",
        targetId: args.messageId,
        meta: JSON.stringify({ channelId: message.channelId }),
      });
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
    return {
      ...result,
      page: result.page.filter((m) => m.pinnedAt !== undefined).map(toMessage),
    };
  },
});
