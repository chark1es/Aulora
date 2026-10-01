import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireInstanceAdmin } from "./lib/instance";
import { recordLicenseActivity } from "./lib/licenseActivity";

export const recordLogin = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => recordLicenseActivity(ctx, userId),
});
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    return ctx.db.query("licenseUsageMonths").order("desc").take(13);
  },
});
export const reports = internalQuery({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("licenseReportKeys").take(24);
    const groups = [];
    for (const key of credentials) {
      const rows = await ctx.db
        .query("licenseUsageMonths")
        .withIndex("by_license_month", (q) => q.eq("licenseId", key.licenseId))
        .filter((q) => q.neq(q.field("finalReported"), true))
        .order("asc")
        .take(24);
      groups.push({
        ciphertext: key.ciphertext,
        licenseId: key.licenseId,
        instanceId: key.instanceId,
        reports: rows
          .filter((r) => !r.finalReported)
          .map((r) => ({
            id: r._id,
            licenseId: r.licenseId,
            month: r.month,
            activeUsers: r.activeUsers,
            final: r.month < new Date(Date.now()).toISOString().slice(0, 7),
          })),
      });
    }
    return groups;
  },
});
export const acknowledge = internalMutation({
  args: { id: v.id("licenseUsageMonths"), activeUsers: v.number(), final: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.activeUsers !== args.activeUsers) return;
    if (args.final)
      await ctx.scheduler.runAfter(0, internal.licenseUsage.purgeIdentities, {
        licenseId: row.licenseId,
        month: row.month,
      });
    await ctx.db.patch(row._id, {
      reportedAt: Date.now(),
      reportedUsers: args.activeUsers,
      finalReported: row.finalReported || args.final,
    });
  },
});

export const purgeIdentities = internalMutation({
  args: { licenseId: v.string(), month: v.string() },
  handler: async (ctx, args) => {
    const aggregate = await ctx.db
      .query("licenseUsageMonths")
      .withIndex("by_license_month", (q) =>
        q.eq("licenseId", args.licenseId).eq("month", args.month),
      )
      .unique();
    if (!aggregate?.finalReported) return;
    const rows = await ctx.db
      .query("licenseActivity")
      .withIndex("by_license_month_user", (q) =>
        q.eq("licenseId", args.licenseId).eq("month", args.month),
      )
      .take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 500)
      await ctx.scheduler.runAfter(0, internal.licenseUsage.purgeIdentities, args);
  },
});
