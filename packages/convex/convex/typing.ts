import { Permission } from "@aulora/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { assertMayParticipate } from "./lib/bans";
import { requireChannelAccess } from "./lib/channels";

/** Typing rows go stale quickly; clients re-send while still typing. */
export const TYPING_TTL_MS = 8_000;
/** Expired rows deleted per purge invocation before rescheduling. */
const TYPING_PURGE_BATCH = 500;

/** Marks the caller as typing in a channel, refreshing the expiry. */
export const set = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const access = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    await assertMayParticipate(ctx, access.userId);
    const expiresAt = Date.now() + TYPING_TTL_MS;
    const existing = await ctx.db
      .query("typing")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", access.userId),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { expiresAt });
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
    const match = await ctx.db
      .query("typing")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", access.userId),
      )
      .unique();
    if (match !== null) {
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

/**
 * Cron hook: deletes expired typing rows. Reads only rows whose `expiresAt`
 * has passed via the `by_expires` index (never the whole table) and drains a
 * large backlog by rescheduling while a batch is full. Deleting the rows is
 * what makes progress, so each follow-up run re-reads from the front.
 */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("typing")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(TYPING_PURGE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === TYPING_PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.typing.purgeExpired, {});
    }
    return rows.length;
  },
});
