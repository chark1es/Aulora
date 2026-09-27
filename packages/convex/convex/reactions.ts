import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
