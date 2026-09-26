import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireChannelAccess } from "./lib/channels";

/**
 * Toggles a reaction. `emojiCiphertext` is opaque; the client must reuse the
 * exact ciphertext it created when removing, since randomized encryption means
 * the same emoji produces different ciphertext each time.
 */
export const toggle = mutation({
  args: { messageId: v.id("messages"), emojiCiphertext: v.string() },
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
    const match = existing.find(
      (reaction) =>
        reaction.userId === access.userId && reaction.emojiCiphertext === args.emojiCiphertext,
    );

    if (match !== undefined) {
      await ctx.db.delete(match._id);
      return { added: false };
    }
    await ctx.db.insert("reactions", {
      messageId: args.messageId,
      userId: access.userId,
      emojiCiphertext: args.emojiCiphertext,
    });
    return { added: true };
  },
});

/** Lists opaque reactions on a message; clients decrypt and group them. */
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
    return reactions.map((reaction) => ({
      id: reaction._id,
      userId: reaction.userId,
      emojiCiphertext: reaction.emojiCiphertext,
    }));
  },
});
