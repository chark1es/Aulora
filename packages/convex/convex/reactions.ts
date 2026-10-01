import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertMayParticipate } from "./lib/bans";
import { requireChannelAccess } from "./lib/channels";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";

/**
 * Reactions store the emoji sealed. Toggling compares the plaintext emoji, so
 * the few rows for one message and user are opened rather than compared in
 * ciphertext (randomized encryption makes identical emoji map to different
 * envelopes). Eventual duplicate rows with the same plaintext are treated as a
 * toggle-off, which keeps the operation idempotent.
 */
function emojiContext(messageId: Id<"messages">) {
  return { scope: "reaction", recordId: messageId as string };
}

export const toggle = mutation({
  args: { messageId: v.id("messages"), emoji: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new ConvexError("Message not found");
    }
    const access = await requireChannelAccess(ctx, message.channelId, Permission.AddReactions);
    await assertMayParticipate(ctx, access.userId);

    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    const mine = existing.filter((reaction) => reaction.userId === access.userId);
    for (const reaction of mine) {
      const emoji = await openContent(emojiContext(args.messageId), reaction.emojiCiphertext);
      if (emoji === args.emoji) {
        await ctx.db.delete(reaction._id);
        return { added: false };
      }
    }
    const emojiCiphertext = await sealString(emojiContext(args.messageId), args.emoji);
    await ctx.db.insert("reactions", {
      messageId: args.messageId,
      userId: access.userId,
      emojiCiphertext,
    });
    return { added: true };
  },
});

/** Lists reactions on a message with the emoji decrypted for the client. */
export const list = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw new ConvexError("Message not found");
    }
    await requireChannelAccess(ctx, message.channelId, Permission.ViewChannel);
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    return await Promise.all(
      reactions.map(async (reaction) => ({
        id: reaction._id,
        userId: reaction.userId,
        emoji: await openContent(emojiContext(args.messageId), reaction.emojiCiphertext),
      })),
    );
  },
});

/** One reaction row keyed by the message it belongs to. */
export interface MessageReactionView {
  readonly messageId: Id<"messages">;
  readonly id: Id<"reactions">;
  readonly userId: string;
  readonly emoji: string;
}

/** Hard cap on message ids resolved by one batched call. */
const MAX_BATCH_MESSAGE_IDS = 100;

/**
 * Batched reactions for a page of messages, so a timeline does not issue one
 * query per message. Ids are deduplicated and capped at 100 per call (extras are
 * ignored). Access is checked once per distinct channel: a channel the viewer
 * cannot view, a missing message, or a message in such a channel is skipped
 * rather than failing the whole batch.
 */
export const listForMessages = query({
  args: { messageIds: v.array(v.id("messages")) },
  handler: async (ctx, args): Promise<MessageReactionView[]> => {
    const ids = [...new Set(args.messageIds)].slice(0, MAX_BATCH_MESSAGE_IDS);
    const messages = await Promise.all(ids.map(async (id) => await ctx.db.get(id)));

    const byChannel = new Map<Id<"channels">, Id<"messages">[]>();
    for (const message of messages) {
      if (message === null) {
        continue;
      }
      const existing = byChannel.get(message.channelId);
      if (existing === undefined) {
        byChannel.set(message.channelId, [message._id]);
      } else {
        existing.push(message._id);
      }
    }

    const allowed: Id<"messages">[] = [];
    for (const [channelId, channelMessageIds] of byChannel) {
      try {
        await requireChannelAccess(ctx, channelId, Permission.ViewChannel);
      } catch {
        continue;
      }
      allowed.push(...channelMessageIds);
    }

    return await Promise.all(
      allowed.map(async (messageId) => {
        const reactions = await ctx.db
          .query("reactions")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .collect();
        return await Promise.all(
          reactions.map(async (reaction) => ({
            messageId,
            id: reaction._id,
            userId: reaction.userId,
            emoji: await openContent(emojiContext(messageId), reaction.emojiCiphertext),
          })),
        );
      }),
    ).then((rows) => rows.flat());
  },
});
