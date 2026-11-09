import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Deletes one session's segments in bounded batches after the session row. */
const SEGMENT_DELETE_BATCH = 100;

export const deleteSegments = internalMutation({
  args: { sessionId: v.id("transcriptionSessions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_session_seq", (q) => q.eq("sessionId", args.sessionId))
      .take(SEGMENT_DELETE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    // Per-speaker replay state belongs to the session too; leaving it behind
    // leaks a row per speaker forever.
    const speakerRows = await ctx.db
      .query("transcriptSpeakerState")
      .withIndex("by_session_speaker", (q) => q.eq("sessionId", args.sessionId))
      .take(SEGMENT_DELETE_BATCH);
    for (const row of speakerRows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === SEGMENT_DELETE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.transcriptionCleanup.deleteSegments, {
        sessionId: args.sessionId,
      });
    }
    return null;
  },
});
