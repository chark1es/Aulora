import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { openContent, openContentOptional } from "./lib/sealed";
import { sealString } from "./lib/sse";

/**
 * Private per-author notes about other members. A note is visible only to the
 * member who wrote it: reads are scoped by `authorId`, and the body is sealed
 * server-side so a database read cannot reveal it.
 */

/**
 * The SSE record id is a length-prefixed encoding rather than
 * `${authorId}:${targetUserId}`: a user id may itself contain `:`, so a plain
 * separator makes two distinct (author, target) pairs share one record id.
 */
function noteContext(authorId: string, targetUserId: string) {
  const recordId = `${authorId.length}:${authorId}:${targetUserId}`;
  return { scope: "userNote", recordId } as const;
}

/** The caller's note about `targetUserId`, or `null`. */
export const get = query({
  args: { targetUserId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const row = await ctx.db
      .query("userNotes")
      .withIndex("by_author_target", (q) =>
        q.eq("authorId", userId).eq("targetUserId", args.targetUserId),
      )
      .unique();
    if (row === null) {
      return { body: null };
    }
    return {
      body: await openContentOptional(noteContext(userId, args.targetUserId), row.bodyCiphertext),
    };
  },
});

/** Creates or replaces the caller's note about a member. An empty body deletes it. */
export const upsert = mutation({
  args: { targetUserId: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.targetUserId.trim().length === 0) {
      throw new ConvexError("A note target is required");
    }
    const existing = await ctx.db
      .query("userNotes")
      .withIndex("by_author_target", (q) =>
        q.eq("authorId", userId).eq("targetUserId", args.targetUserId),
      )
      .unique();
    if (args.body.length === 0) {
      if (existing !== null) {
        await ctx.db.delete(existing._id);
      }
      return { body: null };
    }
    const bodyCiphertext = await sealString(noteContext(userId, args.targetUserId), args.body);
    if (existing === null) {
      await ctx.db.insert("userNotes", {
        authorId: userId,
        targetUserId: args.targetUserId,
        bodyCiphertext,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, { bodyCiphertext, updatedAt: Date.now() });
    }
    return { body: args.body };
  },
});

/** Every note the caller has written, with the body opened server-side. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const rows = await ctx.db
      .query("userNotes")
      .withIndex("by_author", (q) => q.eq("authorId", userId))
      .collect();
    return await Promise.all(
      rows.map(async (row) => ({
        targetUserId: row.targetUserId,
        body: await openContent(noteContext(userId, row.targetUserId), row.bodyCiphertext),
      })),
    );
  },
});
