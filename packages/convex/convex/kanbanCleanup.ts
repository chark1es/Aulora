import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

/** Removes what a deleted card or board leaves behind, a batch at a time. */

async function deleteFile(ctx: MutationCtx, id: Id<"files">) {
  const row = await ctx.db.get(id);
  if (!row) return;
  await ctx.storage.delete(row.storageId);
  await ctx.db.delete(row._id);
}
export const cleanupCard = internalMutation({
  args: {
    cardId: v.id("kanbanCards"),
    boardId: v.id("kanbanBoards"),
    fileIds: v.array(v.id("files")),
  },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.cardId)) return;
    const comments = await ctx.db
      .query("kanbanComments")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .take(100);
    const events = await ctx.db
      .query("kanbanActivity")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .take(100);
    for (const row of comments) await ctx.db.delete(row._id);
    for (const row of events) await ctx.db.delete(row._id);
    if (comments.length === 100 || events.length === 100) {
      await ctx.scheduler.runAfter(0, internal.kanbanCleanup.cleanupCard, args);
      return;
    }
    const remaining = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .collect();
    for (const id of args.fileIds) {
      const file = await ctx.db.get(id);
      if (file?.kanbanBoardId === args.boardId && !remaining.some((c) => c.fileIds.includes(id)))
        await deleteFile(ctx, id);
    }
  },
});
export const cleanupBoard = internalMutation({
  args: { boardId: v.id("kanbanBoards") },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board?.deleted) return;
    const cards = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .take(20);
    for (const card of cards) {
      await ctx.db.delete(card._id);
      await ctx.scheduler.runAfter(0, internal.kanbanCleanup.cleanupCard, {
        cardId: card._id,
        boardId: args.boardId,
        fileIds: card.fileIds,
      });
    }
    if (cards.length) {
      await ctx.scheduler.runAfter(0, internal.kanbanCleanup.cleanupBoard, args);
      return;
    }
    const files = await ctx.db
      .query("files")
      .withIndex("by_kanban_board", (q) => q.eq("kanbanBoardId", args.boardId))
      .take(20);
    for (const file of files) await deleteFile(ctx, file._id);
    if (files.length) {
      await ctx.scheduler.runAfter(0, internal.kanbanCleanup.cleanupBoard, args);
      return;
    }
    await ctx.db.delete(board._id);
  },
});
