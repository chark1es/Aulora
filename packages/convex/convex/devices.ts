import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

/**
 * Device registry. A device is one client install with its own MLS identity.
 * `identityKey` is the public part of that identity; the private half never
 * leaves the device key store, so the server only ever holds public metadata.
 *
 * Phase 5 adds **verification**: a new device is untrusted until an existing
 * verified device approves it after a human compares safety numbers (or scans
 * a QR). The very first device on an account bootstraps the trust root, since
 * it already authenticated with the user's credentials.
 */

const SAFETY_NUMBER_DIGITS = 60;

function normalizeSafetyNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

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
    sharingKey: v.optional(v.string()),
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
        ...(args.sharingKey !== undefined ? { sharingKey: args.sharingKey } : {}),
      });
      return { deviceId: existing._id };
    }
    const deviceId = await ctx.db.insert("devices", {
      userId,
      platform: args.platform,
      identityKey: args.identityKey,
      lastSeen: now,
      ...(args.pushToken !== undefined ? { pushToken: args.pushToken } : {}),
      ...(args.sharingKey !== undefined ? { sharingKey: args.sharingKey } : {}),
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
        sharingKey: device.sharingKey ?? null,
        lastSeen: device.lastSeen,
        verifiedAt: device.verifiedAt ?? null,
      }));
  },
});

/**
 * The caller's X25519 sharing public keys, by user id, for the given devices.
 * A sender reads these to seal a history bundle. Only public keys are exposed.
 */
export const sharingKeys = query({
  args: { deviceIds: v.array(v.id("devices")) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const result: { deviceId: Id<"devices">; userId: string; sharingKey: string }[] = [];
    for (const deviceId of args.deviceIds) {
      const device = await ctx.db.get(deviceId);
      if (device?.sharingKey !== undefined) {
        result.push({ deviceId, userId: device.userId, sharingKey: device.sharingKey });
      }
    }
    return result;
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

/**
 * Approves a device after a human compares safety numbers. The approver must be
 * one of the caller's verified devices; when the account has no verified device
 * yet, the caller's own new device bootstraps the trust root. Idempotent.
 */
export const approve = mutation({
  args: {
    deviceId: v.id("devices"),
    method: v.union(v.literal("safety_number"), v.literal("qr")),
    safetyNumber: v.string(),
    /** The verifying device; omit only to bootstrap the first device. */
    approverDeviceId: v.optional(v.id("devices")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const target = await requireOwnedDevice(ctx, args.deviceId, userId);

    const digits = normalizeSafetyNumber(args.safetyNumber);
    if (digits.length !== SAFETY_NUMBER_DIGITS) {
      throw new ConvexError("Safety number must be 60 digits");
    }
    if (target.verifiedAt !== undefined) {
      return { approved: false, alreadyVerified: true };
    }

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const hasVerified = devices.some(
      (device) => device.verifiedAt !== undefined && device._id !== target._id,
    );

    let approverId: Id<"devices">;
    if (args.approverDeviceId !== undefined) {
      const approver = await requireOwnedDevice(ctx, args.approverDeviceId, userId);
      if (approver.verifiedAt === undefined) {
        throw new ConvexError("Approving device is not verified");
      }
      approverId = approver._id;
    } else if (!hasVerified) {
      // No trust root exists yet: the first authenticated device bootstraps.
      approverId = target._id;
    } else {
      throw new ConvexError("Verification must come from an existing verified device");
    }

    const now = Date.now();
    await ctx.db.patch(target._id, {
      verifiedAt: now,
      verificationMethod: args.approverDeviceId === undefined ? "bootstrap" : args.method,
      ...(args.approverDeviceId !== undefined ? { verifiedByDeviceId: approverId } : {}),
    });
    await ctx.db.insert("deviceApprovals", {
      userId,
      deviceId: target._id,
      approverDeviceId: approverId,
      method: args.approverDeviceId === undefined ? "bootstrap" : args.method,
      safetyNumber: digits,
      approvedAt: now,
    });
    return { approved: true, alreadyVerified: false };
  },
});

/** Clears a device's verification (the operator must re-approve it). */
export const revoke = mutation({
  args: { deviceId: v.id("devices"), approverDeviceId: v.optional(v.id("devices")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const target = await requireOwnedDevice(ctx, args.deviceId, userId);
    if (target.verifiedAt === undefined) {
      return null;
    }
    if (args.approverDeviceId !== undefined) {
      const approver = await requireOwnedDevice(ctx, args.approverDeviceId, userId);
      if (approver.verifiedAt === undefined) {
        throw new ConvexError("Approving device is not verified");
      }
    }
    await ctx.db.patch(target._id, {
      verifiedAt: undefined,
      verifiedByDeviceId: undefined,
      verificationMethod: undefined,
    });
    return null;
  },
});

/** The caller's device approval audit trail, newest first. */
export const approvals = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const rows = await ctx.db
      .query("deviceApprovals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => b.approvedAt - a.approvedAt)
      .map((row) => ({
        deviceId: row.deviceId,
        approverDeviceId: row.approverDeviceId,
        method: row.method,
        safetyNumber: row.safetyNumber,
        approvedAt: row.approvedAt,
      }));
  },
});

/** True when the caller has at least one verified device (trust root exists). */
export const hasVerifiedDevice = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return devices.some((device) => device.verifiedAt !== undefined);
  },
});
