import { Permission } from "@aulora/core";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireChannelAccess } from "./lib/channels";

/** Typing rows go stale quickly; clients re-send while still typing. */
export const TYPING_TTL_MS = 8_000;

/** Marks the caller as typing in a channel, refreshing the expiry. */
export const set = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const expiresAt = Date.now() + TYPING_TTL_MS;
    const existing = await ctx.db
      .query("typing")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    const match = existing.find((row) => row.userId === access.userId);
    if (match !== undefined) {
      await ctx.db.patch(match._id, { expiresAt });
    } else {
      await ctx.db.insert("typing", {
        channelId: args.channelId,
        userId: access.userId,
        expiresAt,
      });
    }
    return { expiresAt };
  },
});

/** Clears the caller's typing row (on send or blur). */
export const clear = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const rows = await ctx.db
      .query("typing")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    const match = rows.find((row) => row.userId === access.userId);
    if (match !== undefined) {
      await ctx.db.delete(match._id);
    }
    return null;
  },
});

/** Lists non-expired typers in a channel. */
export const list = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const now = Date.now();
    const rows = await ctx.db
      .query("typing")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    return rows
      .filter((row) => row.expiresAt > now)
      .map((row) => ({ userId: row.userId, expiresAt: row.expiresAt }));
  },
});

/** Cron hook: deletes expired typing rows. */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("typing").collect();
    let purged = 0;
    for (const row of rows) {
      if (row.expiresAt <= now) {
        await ctx.db.delete(row._id);
        purged += 1;
      }
    }
    return purged;
  },
});
