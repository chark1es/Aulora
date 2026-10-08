import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Purges what a deleted note leaves behind, a batch at a time. */
export const cleanupNote = internalMutation({
  args: { noteId: v.id("notePages") },
  handler: async (ctx, args) => {
    const revisions = await ctx.db
      .query("noteRevisions")
      .withIndex("by_note", (q) => q.eq("noteId", args.noteId))
      .take(100);
    for (const revision of revisions) await ctx.db.delete(revision._id);
    if (revisions.length === 100) {
      await ctx.scheduler.runAfter(0, internal.workspaceNotesCleanup.cleanupNote, args);
    }
  },
});
