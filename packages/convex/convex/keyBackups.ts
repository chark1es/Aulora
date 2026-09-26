import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

/**
 * Recovery-passphrase backups.
 *
 * The server stores only an opaque ciphertext and its Argon2id parameters; the
 * key is derived on the device from a passphrase the server never sees. A user
 * has at most one backup, replaced on each new save.
 */

/** The caller's backup metadata, or `null` when none exists. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const row = await ctx.db
      .query("keyBackups")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row === null) {
      return null;
    }
    return {
      backupCiphertext: row.backupCiphertext,
      kdfParams: row.kdfParams,
      updatedAt: row.updatedAt ?? null,
    };
  },
});

/** Replaces the caller's backup. */
export const put = mutation({
  args: { backupCiphertext: v.string(), kdfParams: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.backupCiphertext.length === 0) {
      throw new ConvexError("Backup ciphertext must not be empty");
    }
    const existing = await ctx.db
      .query("keyBackups")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const now = Date.now();
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        backupCiphertext: args.backupCiphertext,
        kdfParams: args.kdfParams,
        updatedAt: now,
      });
      return { updated: true };
    }
    await ctx.db.insert("keyBackups", {
      userId,
      backupCiphertext: args.backupCiphertext,
      kdfParams: args.kdfParams,
      updatedAt: now,
    });
    return { updated: false };
  },
});

/** Deletes the caller's backup. */
export const remove = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const existing = await ctx.db
      .query("keyBackups")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing !== null) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});
