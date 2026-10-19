import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { adjustInstanceCounters } from "./lib/instance";

/** Devices deleted per prune run before rescheduling. */
const DEVICE_PRUNE_BATCH = 500;
/**
 * Installs unseen for this long are dropped from the registry. Push tokens for
 * uninstalled apps can otherwise linger forever; six months is far beyond any
 * realistic gap between app launches.
 */
/**
 * Default device retention. Override with `DEVICE_RETENTION_DAYS`; a value of
 * 0 disables the prune entirely (keep forever).
 */
export const DEVICE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

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
    await adjustInstanceCounters(ctx, { devices: 1 });
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
    await adjustInstanceCounters(ctx, { devices: -1 });
    return null;
  },
});

/**
 * Cron hook: deletes device rows unseen longer than {@link DEVICE_RETENTION_MS}
 * so stale push tokens stop accumulating. Reads only rows past the cutoff via
 * `by_lastSeen` and reschedules while a batch is full; rows inside the
 * retention window are never deleted.
 */
export const pruneStaleDevices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaultDays = DEVICE_RETENTION_MS / (24 * 60 * 60 * 1000);
    const days = Number(process.env.DEVICE_RETENTION_DAYS ?? defaultDays);
    if (!Number.isFinite(days) || days <= 0) {
      return 0;
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("devices")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", cutoff))
      .take(DEVICE_PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    await adjustInstanceCounters(ctx, { devices: -rows.length });
    if (rows.length === DEVICE_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.devices.pruneStaleDevices, {});
    }
    return rows.length;
  },
});
