import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

/**
 * Device registry. A device is one client install used for push delivery and
 * session listing; with keys held server-side there is no per-device identity
 * or verification state to track. Upsert matches an existing row by push token
 * when one is given, otherwise by platform, and refreshes `lastSeen`.
 */
export const upsert = mutation({
  args: {
    platform: v.string(),
    pushToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const pushToken = args.pushToken?.trim();
    const existing =
      pushToken !== undefined
        ? devices.find((device) => device.pushToken === pushToken)
        : devices
            .filter((device) => device.platform === args.platform)
            .sort((a, b) => b.lastSeen - a.lastSeen)
            .at(0);
    const now = Date.now();
    if (existing !== undefined) {
      await ctx.db.patch(existing._id, {
        platform: args.platform,
        lastSeen: now,
        ...(pushToken !== undefined ? { pushToken } : {}),
      });
      return { deviceId: existing._id };
    }
    const deviceId = await ctx.db.insert("devices", {
      userId,
      platform: args.platform,
      lastSeen: now,
      ...(pushToken !== undefined ? { pushToken } : {}),
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
        pushToken: device.pushToken ?? null,
        lastSeen: device.lastSeen,
      }));
  },
});

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

/** Removes one of the caller's devices from the registry. */
export const revoke = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireOwnedDevice(ctx, args.deviceId, userId);
    await ctx.db.delete(args.deviceId);
    return null;
  },
});
