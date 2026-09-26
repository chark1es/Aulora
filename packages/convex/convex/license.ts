import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireInstanceAdmin } from "./lib/instance";
import { licenseStatus, maskLicenseKey, parseLicenseClaims } from "./lib/license";

/**
 * License status for the instance admin and license screens. Enforcement is by
 * the license terms, not DRM: the server stores the key and reports its parsed
 * state, and the panel nags unlicensed commercial installs.
 */

/** The current license state, plus a masked copy of the stored key. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { server } = await requireInstanceAdmin(ctx);
    return {
      ...licenseStatus(server.licenseKey),
      maskedKey: maskLicenseKey(server.licenseKey),
    };
  },
});

/**
 * Stores or clears the license key. A non-empty key must parse (prefix, fields,
 * checksum) or the mutation is rejected. Passing `null` (or an empty string)
 * clears it.
 */
export const setKey = mutation({
  args: { key: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { userId, server } = await requireInstanceAdmin(ctx);
    const trimmed = args.key?.trim() ?? "";
    if (trimmed.length > 0 && parseLicenseClaims(trimmed) === null) {
      throw new ConvexError("Invalid license key");
    }
    const key = trimmed.length > 0 ? trimmed : null;
    await ctx.db.patch(server._id, { licenseKey: key ?? undefined });
    await writeAudit(ctx, {
      actorId: userId,
      action: key === null ? "instance.license.clear" : "instance.license.set",
    });
    return {
      ...licenseStatus(key),
      maskedKey: maskLicenseKey(key),
    };
  },
});
