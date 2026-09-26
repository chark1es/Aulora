import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireChannelAccess } from "./lib/channels";

async function requireOwnedDevice(
  ctx: Parameters<typeof requireAuth>[0],
  deviceId: Id<"devices">,
  userId: string,
): Promise<void> {
  const device = await ctx.db.get(deviceId);
  if (device === null || device.userId !== userId) {
    throw new ConvexError("Unknown device");
  }
}

/** Publishes one MLS KeyPackage for one of the caller's devices. */
export const publishKeyPackage = mutation({
  args: { deviceId: v.id("devices"), keyPackage: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireOwnedDevice(ctx, args.deviceId, userId);
    const id = await ctx.db.insert("keyPackages", {
      deviceId: args.deviceId,
      keyPackage: args.keyPackage,
    });
    return id;
  },
});

/** Lists unused KeyPackages for a device (no consumption). */
export const listUnused = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("keyPackages")
      .withIndex("by_device_unused", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    return rows
      .filter((row) => row.usedAt === undefined)
      .map((row) => ({ id: row._id, keyPackage: row.keyPackage }));
  },
});

/**
 * Takes up to `count` unused KeyPackages for a device and marks them used.
 * Consuming is one-shot: a concurrent caller cannot take the same package.
 */
export const consume = mutation({
  args: { deviceId: v.id("devices"), count: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireOwnedDevice(ctx, args.deviceId, userId);
    const requested = Math.max(1, Math.floor(args.count ?? 1));
    const rows = await ctx.db
      .query("keyPackages")
      .withIndex("by_device_unused", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    const unused = rows
      .filter((row) => row.usedAt === undefined)
      .sort((a, b) => a._creationTime - b._creationTime);
    const taken = unused.slice(0, requested);
    const now = Date.now();
    for (const row of taken) {
      await ctx.db.patch(row._id, { usedAt: now });
    }
    return taken.map((row) => row.keyPackage);
  },
});

/**
 * Appends an MLS commit (optionally with its Welcome) for a channel epoch and
 * advances the channel's tracked current epoch to the max seen. The server
 * never decrypts or builds commits.
 */
export const appendCommit = mutation({
  args: {
    channelId: v.id("channels"),
    epoch: v.number(),
    commitCiphertext: v.string(),
    welcomeCiphertext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const commitId = await ctx.db.insert("mlsCommits", {
      channelId: args.channelId,
      epoch: args.epoch,
      commitCiphertext: args.commitCiphertext,
      ...(args.welcomeCiphertext !== undefined
        ? { welcomeCiphertext: args.welcomeCiphertext }
        : {}),
    });
    const channel = await ctx.db.get(args.channelId);
    const current = channel?.currentEpoch ?? -1;
    if (args.epoch > current) {
      await ctx.db.patch(args.channelId, { currentEpoch: args.epoch });
    }
    return commitId;
  },
});

/** Lists commits for a channel in ascending epoch order, optionally after one. */
export const listCommits = query({
  args: { channelId: v.id("channels"), afterEpoch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const afterEpoch = args.afterEpoch;
    const query = ctx.db
      .query("mlsCommits")
      .withIndex("by_channel_epoch", (q) =>
        afterEpoch !== undefined
          ? q.eq("channelId", args.channelId).gt("epoch", afterEpoch)
          : q.eq("channelId", args.channelId),
      )
      .order("asc");
    const rows = await query.collect();
    return rows.map((row) => ({
      id: row._id,
      epoch: row.epoch,
      commitCiphertext: row.commitCiphertext,
      welcomeCiphertext: row.welcomeCiphertext ?? null,
    }));
  },
});

/** The channel's current MLS epoch (0 when no commit has been published). */
export const currentEpoch = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { channel } = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    return channel.currentEpoch ?? 0;
  },
});
