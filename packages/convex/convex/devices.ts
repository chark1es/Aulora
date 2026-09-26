import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

/**
 * Device registry. A device is one client install with its own MLS identity.
 * `identityKey` is the public part of that identity; the private half never
 * leaves the device key store, so the server only ever holds public metadata.
 */

/**
 * Registers (or refreshes) the calling user's device. Devices are keyed by
 * their `identityKey`, so signing in again on the same install updates
 * `lastSeen` instead of creating a duplicate.
 */
export const upsert = mutation({
  args: {
    platform: v.string(),
    identityKey: v.string(),
    pushToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const existing = devices.find((device) => device.identityKey === args.identityKey);
    const now = Date.now();
    if (existing !== undefined) {
      await ctx.db.patch(existing._id, {
        platform: args.platform,
        lastSeen: now,
        ...(args.pushToken !== undefined ? { pushToken: args.pushToken } : {}),
      });
      return { deviceId: existing._id };
    }
    const deviceId = await ctx.db.insert("devices", {
      userId,
      platform: args.platform,
      identityKey: args.identityKey,
      lastSeen: now,
      ...(args.pushToken !== undefined ? { pushToken: args.pushToken } : {}),
    });
    return { deviceId };
  },
});

/** Lists the calling user's devices, newest activity first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return devices
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((device) => ({
        id: device._id,
        platform: device.platform,
        identityKey: device.identityKey,
        lastSeen: device.lastSeen,
      }));
  },
});
