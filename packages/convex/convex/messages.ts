import { hasPermission, Permission, withReplyParticipant } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import { emitBotEvent } from "./lib/botEvents";
import {
  broadcastAudiencePage,
  hasBroadcastToken,
  LEGACY_BROADCAST_EXPANSION_LIMIT,
  MASS_PING_LIMIT,
  MASS_PING_WINDOW_MS,
} from "./lib/broadcastMentions";
import { requireChannelAccess } from "./lib/channels";
import { recordLicenseActivity } from "./lib/licenseActivity";
import { filterMentionIds, mentionUserIdsForRoles } from "./lib/mentionIds";
import { clampPageSize } from "./lib/pagination";
import { requireMember } from "./lib/permissions";
import { consumeRateLimit, enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";
import {
  countThreadMentions,
  loadThreadInbox,
  loadThreadInboxPage,
  type ThreadInboxRow,
} from "./lib/threadInbox";
import { upsertThreadParticipant } from "./lib/threadParticipants";
import type { Nullable } from "./lib/types";

/** Generous server limits also cover older clients without composer limits. */
function validateMessageContent(
  body: string,
  attachments: readonly Id<"files">[],
  editing = false,
): void {
  if (body.length > 4000) throw new ConvexError("Message exceeds 4000 characters");
  if (!editing && attachments.length > 10) throw new ConvexError("Too many attachments");
  if (body.trim().length === 0 && attachments.length === 0)
    throw new ConvexError("Message is empty");
}

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
  readonly mentionEveryone: boolean;
  readonly mentionHere: boolean;
  readonly mentionUserIds: string[];
  readonly broadcastDirectUserIds?: string[];
  readonly mentionChannelIds: string[];
  readonly mentionCategoryIds: string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly pinnedAt: number | null;
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  readonly replyParticipantIds?: string[];
  readonly createdAt: number;
  /** Present only on system events (e.g. a pin). */
  readonly systemKind?: "pin";
  readonly systemActorId?: string;
  readonly systemTargetId?: Id<"messages">;
}

async function toMessage(message: Doc<"messages">): Promise<MessageView> {
  return {
    id: message._id,
    channelId: message.channelId,
    authorId: message.authorId,
    body:
      message.deletedAt === undefined
        ? await openContent(messageContext(message.channelId), message.ciphertext)
        : "",
    threadRootId: message.threadRootId ?? null,
    replyToId: message.replyToId ?? null,
    attachmentIds: message.deletedAt === undefined ? message.attachmentIds : [],
    mentionEveryone: message.deletedAt === undefined && message.mentionEveryone === true,
    mentionHere: message.deletedAt === undefined && message.mentionHere === true,
    mentionUserIds: message.deletedAt === undefined ? message.mentionUserIds : [],
    ...(message.broadcastDirectUserIds !== undefined
      ? {
          broadcastDirectUserIds:
            message.deletedAt === undefined ? message.broadcastDirectUserIds : [],
        }
      : {}),
    mentionChannelIds: message.deletedAt === undefined ? (message.mentionChannelIds ?? []) : [],
    mentionCategoryIds: message.deletedAt === undefined ? (message.mentionCategoryIds ?? []) : [],
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
    pinnedAt: message.pinnedAt ?? null,
    replyCount: message.replyCount ?? 0,
    lastReplyAt: message.lastReplyAt ?? null,
    createdAt: message._creationTime,
    ...(message.replyParticipantIds !== undefined
      ? { replyParticipantIds: message.replyParticipantIds }
      : {}),
    ...(message.systemKind !== undefined ? { systemKind: message.systemKind } : {}),
    ...(message.systemActorId !== undefined ? { systemActorId: message.systemActorId } : {}),
    ...(message.systemTargetId !== undefined ? { systemTargetId: message.systemTargetId } : {}),
  };
}

async function toMessages(messages: readonly Doc<"messages">[]): Promise<MessageView[]> {
  return await Promise.all(messages.map(toMessage));
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
  if (
    threadRoot === null ||
    threadRoot.deletedAt !== undefined ||
    threadRoot.channelId !== channelId
  ) {
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
    /**
     * Roles mentioned as `@role`. The server expands them to member ids, so a
     * client does not need the workspace roster to resolve role mentions.
     * Older clients keep sending pre-expanded `mentionUserIds`.
     */
    mentionRoleIds: v.optional(v.array(v.string())),
    mentionEveryone: v.optional(v.boolean()),
    mentionHere: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.SendMessages);
    await assertMayParticipate(ctx, access.userId);
    validateMessageContent(args.body, args.attachmentIds ?? []);
    if ((args.attachmentIds?.length ?? 0) > 0) {
      if (!hasPermission(access.permissions, Permission.AttachFiles))
        throw new ConvexError("Missing permission to attach files");
      for (const id of args.attachmentIds ?? []) {
        const file = await ctx.db.get(id);
        if (
          file === null ||
          file.kanbanBoardId !== undefined ||
          (file.channelId !== undefined && file.channelId !== args.channelId) ||
          (file.uploaderId !== access.userId && file.channelId !== args.channelId)
        ) {
          throw new ConvexError("Attachment not available in this channel");
        }
        // Uploads start private to the uploader; scope them to the channel so
        // its members (the recipients) can resolve and download the file.
        if (file.channelId === undefined) await ctx.db.patch(id, { channelId: args.channelId });
      }
    }
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
    const canSpendMassPingBudget =
      access.channel.kind !== "dm" &&
      access.channel.kind !== "group_dm" &&
      hasPermission(access.permissions, Permission.MentionEveryone);
    const canBroadcast = threadRoot === null && canSpendMassPingBudget;
    const mentionEveryone =
      canBroadcast && args.mentionEveryone === true && hasBroadcastToken(args.body, "everyone");
    const mentionHere =
      canBroadcast && args.mentionHere === true && hasBroadcastToken(args.body, "here");
    if (
      canSpendMassPingBudget &&
      (hasBroadcastToken(args.body, "everyone") || hasBroadcastToken(args.body, "here"))
    ) {
      const budget = await consumeRateLimit(ctx, {
        key: userRateLimitKey("mass-ping", access.userId),
        limit: MASS_PING_LIMIT,
        windowMs: MASS_PING_WINDOW_MS,
      });
      if (!budget.allowed)
        throw new ConvexError("You're mentioning everyone too often. Try again in a minute.");
    }
    const roleMentions = await mentionUserIdsForRoles(
      ctx,
      args.mentionRoleIds ?? [],
      args.channelId,
    );
    const mentions = await filterMentionIds(
      ctx,
      [...(args.mentionUserIds ?? []), ...roleMentions],
      args.mentionChannelIds ?? [],
      args.mentionCategoryIds ?? [],
      access.userId,
    );
    let legacyBroadcastIds: string[] = [];
    let legacyContinuation: { cursor: string; userIds: string[] } | undefined;
    if (mentionEveryone || mentionHere) {
      const audience = await broadcastAudiencePage(ctx, args.channelId, null, true);
      if (audience.cursor === null && audience.userIds.length <= LEGACY_BROADCAST_EXPANSION_LIMIT) {
        legacyBroadcastIds = audience.userIds;
      } else if (
        audience.cursor !== null &&
        audience.userIds.length <= LEGACY_BROADCAST_EXPANSION_LIMIT
      ) {
        legacyContinuation = { cursor: audience.cursor, userIds: audience.userIds };
      }
    }
    const ciphertext = await sealString(messageContext(args.channelId), args.body);
    const messageId = await ctx.db.insert("messages", {
      channelId: args.channelId,
      authorId: access.userId,
      ciphertext,
      attachmentIds: args.attachmentIds ?? [],
      mentionUserIds: [...new Set([...mentions.mentionUserIds, ...legacyBroadcastIds])],
      ...(mentionEveryone ? { mentionEveryone: true } : {}),
      ...(mentionHere ? { mentionHere: true } : {}),
      ...(legacyBroadcastIds.length > 0 || legacyContinuation !== undefined
        ? { broadcastDirectUserIds: mentions.mentionUserIds }
        : {}),
      mentionChannelIds: mentions.mentionChannelIds,
      mentionCategoryIds: mentions.mentionCategoryIds,
      ...(args.threadRootId !== undefined ? { threadRootId: args.threadRootId } : {}),
      ...(args.replyToId !== undefined ? { replyToId: args.replyToId } : {}),
    });
    if (legacyContinuation !== undefined) {
      const jobId = await ctx.db.insert("broadcastMentionJobs", {
        messageId,
        ...legacyContinuation,
      });
      await ctx.scheduler.runAfter(0, internal.messages.continueLegacyBroadcast, { jobId });
    }
    let replyAt = 0;
    if (threadRoot !== null) {
      const reply = await ctx.db.get(messageId);
      replyAt = reply?._creationTime ?? Date.now();
      await ctx.db.patch(threadRoot._id, {
        replyCount: (threadRoot.replyCount ?? 0) + 1,
        lastReplyAt: replyAt,
        replyParticipantIds: withReplyParticipant(threadRoot.replyParticipantIds, access.userId),
      });
      // Replying makes the author a thread participant (authoring a root alone
      // does not). Mentions count wherever they appear in the thread.
      await upsertThreadParticipant(ctx, {
        userId: access.userId,
        threadRootId: threadRoot._id,
        channelId: args.channelId,
        at: replyAt,
        mentioned: false,
        participated: true,
      });
    }
    // Thread participation rows only exist for actual threads: a top-level
    // message's mentions are notified, not added to the Threads inbox. When the
    // first reply arrives, seed the root's mentions so they still surface.
    if (threadRoot !== null) {
      const mentionedUsers = [
        ...new Set([
          ...((threadRoot.replyCount ?? 0) === 0
            ? (threadRoot.broadcastDirectUserIds ?? threadRoot.mentionUserIds).filter(
                (id) => id !== threadRoot.authorId,
              )
            : []),
          ...mentions.mentionUserIds.filter((id) => id !== access.userId),
        ]),
      ];
      await recordThreadMentions(ctx, {
        threadRootId: threadRoot._id,
        channelId: args.channelId,
        at: replyAt,
        userIds: mentionedUsers,
      });
    }
    await emitBotEvent(ctx, {
      type: "message.created",
      channelId: args.channelId,
      messageId,
    });
    // Resolve recipients once and fan out content-free wakes (Web Push and the
    // mobile relay) from a single scheduled job, so a burst of messages no
    // longer resolves recipients twice per message. The action no-ops when
    // neither transport is configured.
    if (mentionEveryone || mentionHere) {
      // Persist the initial recovery job in the send transaction, before any action can crash.
      await ctx.db.insert("notificationDeliveryClaims", {
        messageId,
        cursor: "",
        leaseUntil: 1,
        retryAt: 1,
      });
    }
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchForMessage, { messageId });
    await recordLicenseActivity(ctx, access.userId);
    return messageId;
  },
});

/** Resolve small visible audiences even when many workspace members cannot view. */
export const continueLegacyBroadcast = internalMutation({
  args: { jobId: v.id("broadcastMentionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (job === null) return;
    const message = await ctx.db.get(job.messageId);
    if (message === null || message.deletedAt !== undefined) {
      await ctx.db.delete(jobId);
      return;
    }
    const page = await broadcastAudiencePage(ctx, message.channelId, job.cursor);
    const userIds = [...new Set([...job.userIds, ...page.userIds])];
    if (userIds.length > LEGACY_BROADCAST_EXPANSION_LIMIT) {
      // Keep the original direct-mention snapshot on overflow.
      await ctx.db.delete(jobId);
    } else if (page.cursor === null) {
      await ctx.db.patch(message._id, {
        mentionUserIds: [...new Set([...message.mentionUserIds, ...userIds])],
      });
      await ctx.db.delete(jobId);
    } else {
      await ctx.db.patch(jobId, { cursor: page.cursor, userIds });
      await ctx.scheduler.runAfter(0, internal.messages.continueLegacyBroadcast, { jobId });
    }
  },
});

/** Bound synchronous writes; the continuation carries the original mention snapshot. */
const THREAD_MENTION_BATCH = 100;

interface ThreadMentionBatch {
  threadRootId: Id<"messages">;
  channelId: Id<"channels">;
  at: number;
  userIds: string[];
}

async function recordThreadMentions(ctx: MutationCtx, args: ThreadMentionBatch): Promise<void> {
  for (const userId of args.userIds.slice(0, THREAD_MENTION_BATCH)) {
    await upsertThreadParticipant(ctx, {
      userId,
      threadRootId: args.threadRootId,
      channelId: args.channelId,
      at: args.at,
      mentioned: true,
      participated: false,
    });
  }
  if (args.userIds.length > THREAD_MENTION_BATCH) {
    await ctx.scheduler.runAfter(0, internal.messages.continueThreadMentions, {
      ...args,
      userIds: args.userIds.slice(THREAD_MENTION_BATCH),
    });
  }
}

/** Idempotent, atomic batch plus continuation; retries cannot lose progress. */
export const continueThreadMentions = internalMutation({
  args: {
    threadRootId: v.id("messages"),
    channelId: v.id("channels"),
    at: v.number(),
    userIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const root = await ctx.db.get(args.threadRootId);
    if (root === null || root.deletedAt !== undefined) return;
    await recordThreadMentions(ctx, args);
  },
});

/**
 * Paginated channel timeline. Pages walk backwards from the newest message, so
 * the first page is always the live tail and `continueCursor` loads older
 * history; each page is returned oldest first for rendering. Thread replies are
 * filtered before pagination so they never crowd roots out of a page; use
 * {@link listThread} for replies. Deleted messages are still returned with
 * `deletedAt` set so read-state math can ignore them, but every client hides
 * them from the timeline (no tombstone is rendered).
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
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
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
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
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
    await assertMayParticipate(ctx, access.userId);
    const isAuthor = message.authorId === access.userId;
    if (!isAuthor && !hasPermission(access.permissions, Permission.ManageMessages)) {
      throw new ConvexError("Missing permission");
    }
    if (message.deletedAt !== undefined) throw new ConvexError("Cannot edit a deleted message");
    validateMessageContent(args.body, message.attachmentIds, true);
    const ciphertext = await sealString(messageContext(message.channelId), args.body);
    await ctx.db.patch(args.messageId, { ciphertext, editedAt: Date.now() });
    await emitBotEvent(ctx, {
      type: "message.updated",
      channelId: message.channelId,
      messageId: args.messageId,
    });
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
    await assertMayParticipate(ctx, access.userId);
    const isAuthor = message.authorId === access.userId;
    if (!isAuthor && !hasPermission(access.permissions, Permission.ManageMessages)) {
      throw new ConvexError("Missing permission");
    }
    if (message.deletedAt === undefined) {
      await ctx.db.patch(args.messageId, { deletedAt: Date.now() });
      await emitBotEvent(ctx, {
        type: "message.deleted",
        channelId: message.channelId,
        messageId: args.messageId,
      });
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

/**
 * Posts the quiet "<actor> pinned a message" line the timeline renders for a
 * pin. The body is sealed empty: the client renders the event from the system
 * fields, never from message text, so nothing about the pinned message leaks.
 */
async function insertPinNotice(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  actorId: string,
  targetId: Id<"messages">,
): Promise<void> {
  const ciphertext = await sealString(messageContext(channelId), "");
  await ctx.db.insert("messages", {
    channelId,
    authorId: actorId,
    ciphertext,
    attachmentIds: [],
    mentionUserIds: [],
    systemKind: "pin",
    systemActorId: actorId,
    systemTargetId: targetId,
  });
}

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
      await insertPinNotice(ctx, message.channelId, access.userId, args.messageId);
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
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
    // Deleted messages are hidden everywhere, so a deleted pin must not surface
    // here (or consume the page).
    const pinned = result.page.filter(
      (message) => message.pinnedAt !== undefined && message.deletedAt === undefined,
    );
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
 * Reads the viewer's `threadParticipants` rows (bounded, newest first) rather
 * than scanning the newest `messages` globally; bodies are opened server-side so
 * the client always receives plaintext, never ciphertext. `limit` bounds the
 * page (default 50, max 50), but up to 500 candidate roots are read; the full
 * inbox should only be subscribed while it is open.
 */
export const threadInbox = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ThreadInboxRow[]> => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    return await loadThreadInbox(ctx, userId, args.limit);
  },
});

/** Additive cursor API; the legacy array API keeps its original response shape. */
export const threadInboxPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    return await loadThreadInboxPage(ctx, userId, args.paginationOpts.cursor);
  },
});

/**
 * The Threads badge counts up to 50 unacknowledged mentioned participation rows.
 * Reads bounded participation candidates and rechecks access without opening
 * message bodies, so the sidebar can show it while the inbox is closed.
 */
export const threadMentionCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    return await countThreadMentions(ctx, userId);
  },
});

/** Acknowledges at most 50 of the caller's thread mentions per invocation. */
export const markThreadMentionsSeen = mutation({
  args: { lastReplyAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const rows = await ctx.db
      .query("threadParticipants")
      .withIndex("by_user_mentioned", (q) => {
        const base = q.eq("userId", userId).eq("mentioned", true);
        return args.lastReplyAt === undefined ? base : base.lte("lastReplyAt", args.lastReplyAt);
      })
      .order("desc")
      .take(50);
    for (const row of rows) await ctx.db.patch(row._id, { mentioned: false });
    return { cleared: rows.length, hasMore: rows.length === 50 };
  },
});
