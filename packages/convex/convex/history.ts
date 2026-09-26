import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { findChannelMember, requireChannelAccess } from "./lib/channels";

/**
 * History sharing for new members and new devices.
 *
 * MLS forward secrecy means a device that joins a channel later cannot read the
 * ciphertext from before it joined. This module is the *transport* for the fix:
 * an existing device encrypts the channel's history key to the newcomer's
 * X25519 `sharingKey` (see `@aulora/crypto` history-sharing) and the server
 * relays the opaque envelope. Archive snapshots are encrypted under that key.
 *
 * The server never sees a history key or plaintext; it only orders and delivers
 * opaque strings.
 */

async function requireOwnedDevice(
  ctx: Parameters<typeof requireAuth>[0],
  deviceId: Id<"devices">,
  userId: string,
) {
  const device = await ctx.db.get(deviceId);
  if (device === null || device.userId !== userId) {
    throw new ConvexError("Unknown device");
  }
  return device;
}

/** Publishes (idempotently) an existing channel-history snapshot at an epoch. */
export const putArchive = mutation({
  args: { channelId: v.id("channels"), epoch: v.number(), archiveCiphertext: v.string() },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    if (args.archiveCiphertext.length === 0) {
      throw new ConvexError("Archive ciphertext must not be empty");
    }
    const existing = await ctx.db
      .query("historyArchives")
      .withIndex("by_channel_epoch", (q) =>
        q.eq("channelId", args.channelId).eq("epoch", args.epoch),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { archiveCiphertext: args.archiveCiphertext });
      return { updated: true };
    }
    await ctx.db.insert("historyArchives", {
      channelId: args.channelId,
      epoch: args.epoch,
      archiveCiphertext: args.archiveCiphertext,
      createdAt: Date.now(),
    });
    return { updated: false };
  },
});

/** Lists a channel's archive snapshots in ascending epoch order. */
export const listArchives = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const rows = await ctx.db
      .query("historyArchives")
      .withIndex("by_channel_epoch", (q) => q.eq("channelId", args.channelId))
      .collect();
    return rows
      .sort((a, b) => a.epoch - b.epoch)
      .map((row) => ({ epoch: row.epoch, archiveCiphertext: row.archiveCiphertext }));
  },
});

/**
 * Asks an online member to share the channel's history key with one of the
 * caller's devices. Idempotent while a request is outstanding.
 */
export const requestHistory = mutation({
  args: { channelId: v.id("channels"), deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const { userId } = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    await requireOwnedDevice(ctx, args.deviceId, userId);
    const rows = await ctx.db
      .query("historyRequests")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    const outstanding = rows.find(
      (row) => row.deviceId === args.deviceId && row.servicedAt === undefined,
    );
    if (outstanding !== undefined) {
      return outstanding._id;
    }
    return await ctx.db.insert("historyRequests", {
      channelId: args.channelId,
      userId,
      deviceId: args.deviceId,
      createdAt: Date.now(),
    });
  },
});

/** Pending history requests for a channel, oldest first. */
export const listRequests = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const rows = await ctx.db
      .query("historyRequests")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    return rows
      .filter((row) => row.servicedAt === undefined)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id,
        userId: row.userId,
        deviceId: row.deviceId,
        createdAt: row.createdAt,
      }));
  },
});

/**
 * Delivers a sealed history bundle to a recipient device. The recipient must be
 * a member of the channel; the envelope is opaque to the server.
 */
export const shareBundle = mutation({
  args: {
    channelId: v.id("channels"),
    recipientDeviceId: v.id("devices"),
    envelope: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const recipient = await ctx.db.get(args.recipientDeviceId);
    if (recipient === null) {
      throw new ConvexError("Unknown recipient device");
    }
    if (!(await findChannelMember(ctx, args.channelId, recipient.userId))) {
      throw new ConvexError("Recipient is not a channel member");
    }
    if (args.envelope.length === 0) {
      throw new ConvexError("History envelope must not be empty");
    }
    return await ctx.db.insert("historyBundles", {
      channelId: args.channelId,
      recipientUserId: recipient.userId,
      recipientDeviceId: recipient._id,
      envelope: args.envelope,
      createdAt: Date.now(),
    });
  },
});

/** Lists an owned device's unconsumed history bundles, oldest first. */
export const listBundles = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireOwnedDevice(ctx, args.deviceId, userId);
    const rows = await ctx.db
      .query("historyBundles")
      .withIndex("by_recipient_device", (q) => q.eq("recipientDeviceId", args.deviceId))
      .collect();
    return rows
      .filter((row) => row.consumedAt === undefined)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id,
        channelId: row.channelId,
        envelope: row.envelope,
        createdAt: row.createdAt,
      }));
  },
});

/** Marks an owned device's bundle as imported and its request serviced. */
export const markBundleConsumed = mutation({
  args: { bundleId: v.id("historyBundles") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const bundle = await ctx.db.get(args.bundleId);
    if (bundle === null) {
      return null;
    }
    await requireOwnedDevice(ctx, bundle.recipientDeviceId, userId);
    if (bundle.consumedAt === undefined) {
      await ctx.db.patch(bundle._id, { consumedAt: Date.now() });
    }
    const requests = await ctx.db
      .query("historyRequests")
      .withIndex("by_device", (q) => q.eq("deviceId", bundle.recipientDeviceId))
      .collect();
    for (const request of requests) {
      if (request.channelId === bundle.channelId && request.servicedAt === undefined) {
        await ctx.db.patch(request._id, { servicedAt: Date.now() });
      }
    }
    return null;
  },
});

/** Marks a history request serviced once a bundle has been delivered. */
export const markRequestServiced = mutation({
  args: { requestId: v.id("historyRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (request === null) {
      return null;
    }
    await requireChannelAccess(ctx, request.channelId, Permission.ViewChannel);
    if (request.servicedAt === undefined) {
      await ctx.db.patch(request._id, { servicedAt: Date.now() });
    }
    return null;
  },
});
