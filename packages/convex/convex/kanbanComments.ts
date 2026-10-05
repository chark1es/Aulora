import { hasPermission, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireBoard } from "./lib/kanban";
import { activity, cardAccess, text } from "./lib/kanbanCards";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";

export const comments = query({
  args: { cardId: v.id("kanbanCards"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("Card not found");
    await requireBoard(ctx, card.boardId);
    const result = await ctx.db
      .query("kanbanComments")
      .withIndex("by_card", (q) => q.eq("cardId", card._id))
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: Math.min(50, args.paginationOpts.numItems) });
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (c) => ({
          id: c._id,
          authorId: c.authorId,
          at: c._creationTime,
          updatedAt: c.updatedAt,
          body: await openContent({ scope: "kanban.comment", recordId: c._id }, c.bodyCiphertext),
        })),
      ),
    };
  },
});
export const comment = mutation({
  args: {
    cardId: v.id("kanbanCards"),
    body: v.string(),
    commentId: v.optional(v.id("kanbanComments")),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { card, userId, permissions } = await cardAccess(
      ctx,
      args.cardId,
      args.commentId ? Permission.ViewKanban : Permission.CommentKanban,
    );
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("kanban.comment", userId),
      limit: 30,
      windowMs: 60000,
    });
    if (!args.remove) text(args.body, "Comment", 10000);
    let id = args.commentId;
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.cardId !== card._id)
        throw new ConvexError("Comment not found on this card");
      const mayModerate = hasPermission(permissions, Permission.ManageKanban);
      if (
        !mayModerate &&
        (existing.authorId !== userId || !hasPermission(permissions, Permission.CommentKanban))
      )
        throw new ConvexError("You can only edit your own comments");
      if (args.remove) {
        await ctx.db.delete(id);
        await activity(ctx, card._id, userId, "Deleted a comment");
        return;
      }
    } else {
      if (args.remove) throw new ConvexError("Comment not found");
      id = await ctx.db.insert("kanbanComments", {
        cardId: card._id,
        authorId: userId,
        bodyCiphertext: "",
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(id, {
      bodyCiphertext: await sealString({ scope: "kanban.comment", recordId: id }, args.body),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(card._id, { updatedAt: Date.now() });
    await activity(ctx, card._id, userId, args.commentId ? "Edited a comment" : "Added a comment");
  },
});
export const history = query({
  args: { cardId: v.id("kanbanCards") },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("Card not found");
    await requireBoard(ctx, card.boardId);
    const rows = await ctx.db
      .query("kanbanActivity")
      .withIndex("by_card", (q) => q.eq("cardId", card._id))
      .order("desc")
      .take(50);
    return Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        actorId: r.actorId,
        at: r.at,
        body: await openContent({ scope: "kanban.activity", recordId: r._id }, r.bodyCiphertext),
      })),
    );
  },
});

/** Deletes are immediate for readers; storage and history cleanup is bounded. */
