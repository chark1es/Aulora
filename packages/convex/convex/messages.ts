import { hasPermission, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { findChannelMember, isDmKind, requireChannelAccess } from "./lib/channels";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";

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
  readonly threadRootId: Id<"messages"> | null;
  readonly replyToId: Id<"messages"> | null;
  readonly attachmentIds: Id<"files">[];
  readonly mentionUserIds: string[];
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

/** Sends a message: the server seals the plaintext body before storing it. */
export const send = mutation({
  args: {
    channelId: v.id("channels"),
    body: v.string(),
    threadRootId: v.optional(v.id("messages")),
    replyToId: v.optional(v.id("messages")),
    attachmentIds: v.optional(v.array(v.id("files"))),
    mentionUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.SendMessages);
    let threadRoot: Doc<"messages"> | null = null;
    if (args.threadRootId !== undefined) {
      if (!hasPermission(access.permissions, Permission.SendInThreads)) {
        throw new ConvexError("Missing permission");
      }
      threadRoot = await ctx.db.get(args.threadRootId);
      if (threadRoot === null || threadRoot.channelId !== args.channelId) {
        throw new ConvexError("Thread root not found in channel");
      }
      if (threadRoot.threadRootId !== undefined) {
        throw new ConvexError("Threads cannot be nested");
      }
    }
    if (args.replyToId !== undefined) {
      const replyTo = await ctx.db.get(args.replyToId);
      if (replyTo === null || replyTo.channelId !== args.channelId) {
        throw new ConvexError("Reply target not found in channel");
      }
    }
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("send", access.userId),
      limit: sendLimit(),
      windowMs: sendWindowMs(),
    });
    const ciphertext = await sealString(messageContext(args.channelId), args.body);
    const messageId = await ctx.db.insert("messages", {
      channelId: args.channelId,
      authorId: access.userId,
      ciphertext,
      attachmentIds: args.attachmentIds ?? [],
      mentionUserIds: args.mentionUserIds ?? [],
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
    const pinned = result.page.filter((message) => message.pinnedAt !== undefined);
    return { ...result, page: await toMessages(pinned) };
  },
});

/** One row of the Threads inbox, with its root body opened server-side. */
export interface ThreadInboxRow {
  /** Root message id. */
  readonly id: Id<"messages">;
  readonly channelId: Id<"channels">;
  readonly authorId: string;
  /** Plaintext root body (`openContent`); never the stored ciphertext. */
  readonly body: string;
  /** Root `_creationTime`. */
  readonly createdAt: number;
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  /** Distinct authors of the replies scanned. */
  readonly participantIds: string[];
  /** Distinct users mentioned by the root or any scanned reply. */
  readonly mentionedUserIds: string[];
  readonly viewerParticipated: boolean;
  readonly viewerMentioned: boolean;
}

/** Newest messages scanned when assembling the inbox (no new index). */
const THREAD_INBOX_SCAN_LIMIT = 1000;
/** Maximum threads returned, most recently active first. */
const THREAD_INBOX_MAX_ROWS = 50;

/**
 * Filters `channelIds` down to the ones the viewer may currently view, so a
 * thread in a channel the viewer has since been removed from is dropped rather
 * than leaking its root body. Permission bits plus DM/private membership are
 * resolved once per distinct channel.
 */
async function viewableChannelIds(
  ctx: QueryCtx,
  userId: string,
  channelIds: readonly Id<"channels">[],
): Promise<Set<string>> {
  const unique = [...new Set(channelIds)];
  const viewable = new Set<string>();
  if (unique.length === 0) {
    return viewable;
  }
  const context = await loadPermissionContext(ctx, userId);
  for (const channelId of unique) {
    const channel = await ctx.db.get(channelId);
    if (channel === null) {
      continue;
    }
    const categoryOverrides = await categoryOverridesFor(ctx, channel);
    const permissions = channelPermissions(context, channel, categoryOverrides);
    if (!hasPermission(permissions, Permission.ViewChannel)) {
      continue;
    }
    if (
      (isDmKind(channel.kind) || channel.private === true) &&
      !(await findChannelMember(ctx, channelId, userId))
    ) {
      continue;
    }
    viewable.add(channelId);
  }
  return viewable;
}

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
    const recent = await ctx.db.query("messages").order("desc").take(THREAD_INBOX_SCAN_LIMIT);

    interface ThreadAccumulator {
      readonly participantIds: Set<string>;
      readonly mentionedUserIds: Set<string>;
      replyCount: number;
      maxReplyAt: number;
    }

    const byRoot = new Map<Id<"messages">, ThreadAccumulator>();
    for (const message of recent) {
      const rootId = message.threadRootId;
      if (rootId === undefined) {
        continue;
      }
      const accumulator =
        byRoot.get(rootId) ??
        ({
          participantIds: new Set<string>(),
          mentionedUserIds: new Set<string>(),
          replyCount: 0,
          maxReplyAt: 0,
        } satisfies ThreadAccumulator);
      accumulator.participantIds.add(message.authorId);
      for (const mentioned of message.mentionUserIds) {
        accumulator.mentionedUserIds.add(mentioned);
      }
      accumulator.replyCount += 1;
      accumulator.maxReplyAt = Math.max(accumulator.maxReplyAt, message._creationTime);
      byRoot.set(rootId, accumulator);
    }

    const rootEntries = await Promise.all(
      [...byRoot.keys()].map(async (rootId) => {
        const root = await ctx.db.get(rootId);
        return root === null ? null : { rootId, root };
      }),
    );
    const rootById = new Map<Id<"messages">, Doc<"messages">>();
    for (const entry of rootEntries) {
      if (entry !== null) {
        rootById.set(entry.rootId, entry.root);
      }
    }

    const viewable = await viewableChannelIds(
      ctx,
      userId,
      [...rootById.values()].map((root) => root.channelId),
    );

    const candidates: Omit<ThreadInboxRow, "body">[] = [];
    for (const [rootId, root] of rootById) {
      if (!viewable.has(root.channelId)) {
        continue;
      }
      const accumulator = byRoot.get(rootId);
      if (accumulator === undefined) {
        continue;
      }
      const participantIds = [...accumulator.participantIds].sort();
      const mentionedUserIds = [
        ...new Set([...(root.mentionUserIds ?? []), ...accumulator.mentionedUserIds]),
      ].sort();
      const viewerParticipated = participantIds.includes(userId);
      const viewerMentioned = mentionedUserIds.includes(userId);
      if (!viewerParticipated && !viewerMentioned) {
        continue;
      }
      candidates.push({
        id: root._id,
        channelId: root.channelId,
        authorId: root.authorId,
        createdAt: root._creationTime,
        replyCount: root.replyCount ?? accumulator.replyCount,
        lastReplyAt: root.lastReplyAt ?? accumulator.maxReplyAt,
        participantIds,
        mentionedUserIds,
        viewerParticipated,
        viewerMentioned,
      });
    }

    candidates.sort((a, b) => (b.lastReplyAt ?? b.createdAt) - (a.lastReplyAt ?? a.createdAt));

    const top = candidates.slice(0, THREAD_INBOX_MAX_ROWS);
    return await Promise.all(
      top.map(async (row) => {
        const root = rootById.get(row.id);
        if (root === undefined) {
          throw new ConvexError("Thread root not found");
        }
        return {
          ...row,
          body: await openContent(messageContext(root.channelId), root.ciphertext),
        };
      }),
    );
  },
});
