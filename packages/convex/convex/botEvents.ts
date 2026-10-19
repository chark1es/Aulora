/**
 * Bot-facing event feed plus retention. `poll` is the only function a bot
 * calls that is not a normal member function: it returns message and reaction
 * events the bot is allowed to see, with bodies opened server-side. `prune`
 * drops events after one hour. See `docs/bots-design.md`.
 */
import { hasPermission, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { loadBotByUserId } from "./lib/botAuth";
import type { BotEvent, BotEventMessage, BotPollResult } from "./lib/botTypes";
import { findChannelMember, isDmKind } from "./lib/channels";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./lib/permissions";
import { openContent } from "./lib/sealed";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
/** Events scanned per pagination page while filtering for visibility. */
const SCAN_PAGE = 200;
const RETENTION_MS = 60 * 60 * 1000;
const PRUNE_BATCH = 500;
const PRUNE_MAX_BATCHES = 100;

/** SSE scope binding a message body to its channel; mirrors `messages.ts`. */
function messageContext(channelId: Id<"channels">) {
  return { scope: "message", recordId: channelId as string };
}

/** SSE scope binding a sealed emoji to its message; mirrors `reactions.ts`. */
function reactionContext(messageId: Id<"messages">) {
  return { scope: "reaction", recordId: messageId as string };
}

/** The calling bot, requiring an enabled `bots` row for this identity. */
async function requireBot(ctx: QueryCtx): Promise<Doc<"bots">> {
  const { userId } = await requireAuth(ctx);
  const bot = await loadBotByUserId(ctx, userId);
  if (bot === null || !bot.enabled) {
    throw new ConvexError("Not a bot");
  }
  return bot;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

async function botEventMessage(message: Doc<"messages">): Promise<BotEventMessage> {
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
    createdAt: message._creationTime,
  };
}

/** Renders one stored event, opening the body/emoji and marking self-actions. */
async function toBotEvent(
  ctx: QueryCtx,
  row: Doc<"botEvents">,
  botUserId: string,
): Promise<BotEvent> {
  const base = { seq: row._creationTime, type: row.type, channelId: row.channelId };
  if (row.messageId === undefined) {
    return { ...base, message: null, reaction: null, self: false };
  }
  if (row.type === "reaction.added" || row.type === "reaction.removed") {
    const emoji =
      row.emojiCiphertext === undefined
        ? ""
        : await openContent(reactionContext(row.messageId), row.emojiCiphertext);
    return {
      ...base,
      message: null,
      reaction: { messageId: row.messageId, userId: row.userId ?? "", emoji },
      self: row.userId === botUserId,
    };
  }
  const message = await ctx.db.get(row.messageId);
  if (message === null) {
    return { ...base, message: null, reaction: null, self: false };
  }
  const view = await botEventMessage(message);
  return {
    ...base,
    // Deletes are soft and keep the ciphertext, so blank the body whenever the
    // message is deleted now, not only for the delete event itself.
    message:
      row.type === "message.deleted" || message.deletedAt !== undefined
        ? { ...view, body: "" }
        : view,
    reaction: null,
    self: message.authorId === botUserId,
  };
}

/**
 * Whether the bot holds `ViewChannel` + `ReadHistory` on the channel, reusing
 * the shared resolution (which already clamps to grants and the allowlist) plus
 * the DM/private membership gate. Results are cached per poll.
 */
async function botCanSeeChannel(
  ctx: QueryCtx,
  context: Awaited<ReturnType<typeof loadPermissionContext>>,
  channelId: Id<"channels">,
  cache: Map<Id<"channels">, boolean>,
): Promise<boolean> {
  const cached = cache.get(channelId);
  if (cached !== undefined) {
    return cached;
  }
  const channel = await ctx.db.get(channelId);
  let allowed = false;
  if (channel !== null) {
    const permissions = channelPermissions(
      context,
      channel,
      await categoryOverridesFor(ctx, channel),
    );
    allowed =
      hasPermission(permissions, Permission.ViewChannel) &&
      hasPermission(permissions, Permission.ReadHistory);
    if (allowed && (isDmKind(channel.kind) || channel.private === true)) {
      allowed = await findChannelMember(ctx, channelId, context.userId);
    }
  }
  cache.set(channelId, allowed);
  return allowed;
}

interface CollectedEvents {
  readonly events: BotEvent[];
  /** Newest `_creationTime` examined, so a poll with no matches still advances. */
  readonly lastSeen: number;
  readonly truncated: boolean;
}

/** Scans events after `from` in pages, keeping only what the bot may see. */
async function collectEvents(
  ctx: QueryCtx,
  context: Awaited<ReturnType<typeof loadPermissionContext>>,
  botUserId: string,
  from: number,
  limit: number,
): Promise<CollectedEvents> {
  const events: BotEvent[] = [];
  const cache = new Map<Id<"channels">, boolean>();
  let lastSeen = from;
  let pageCursor: string | null = null;
  let isDone = false;
  while (!isDone && events.length < limit) {
    const page = await ctx.db
      .query("botEvents")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", from))
      .order("asc")
      .paginate({ numItems: SCAN_PAGE, cursor: pageCursor });
    for (const row of page.page) {
      lastSeen = row._creationTime;
      if (!(await botCanSeeChannel(ctx, context, row.channelId, cache))) {
        continue;
      }
      events.push(await toBotEvent(ctx, row, botUserId));
      if (events.length >= limit) {
        break;
      }
    }
    pageCursor = page.continueCursor;
    isDone = page.isDone;
  }
  return { events, lastSeen, truncated: events.length >= limit };
}

/** Events after `cursor` that the calling bot may see. Only bots may call it. */
export const poll = query({
  args: { cursor: v.union(v.number(), v.null()), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BotPollResult> => {
    const bot = await requireBot(ctx);
    const me = { userId: bot.userId, name: bot.name };
    if (args.cursor === null) {
      // First poll starts at "now": no history, no replay of what came before.
      const newest = await ctx.db.query("botEvents").order("desc").first();
      return { events: [], cursor: newest?._creationTime ?? Date.now(), me };
    }
    const limit = clampLimit(args.limit);
    const context = await loadPermissionContext(ctx, bot.userId);
    const collected = await collectEvents(ctx, context, bot.userId, args.cursor, limit);
    const last = collected.events.at(-1);
    const cursor = collected.truncated && last !== undefined ? last.seq : collected.lastSeen;
    return { events: collected.events, cursor, me };
  },
});

/** Deletes events older than one hour. Scheduled from `crons.ts`. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const cutoff = Date.now() - RETENTION_MS;
    for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
      const old = await ctx.db
        .query("botEvents")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(PRUNE_BATCH);
      for (const row of old) {
        await ctx.db.delete(row._id);
      }
      if (old.length < PRUNE_BATCH) {
        break;
      }
    }
    return null;
  },
});
