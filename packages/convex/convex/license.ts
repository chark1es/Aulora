import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { sha256Hex } from "./lib/crypto";
import { requireInstanceAdmin } from "./lib/instance";
import { isLicenseKey, licenseStatus, maskLicenseKey } from "./lib/license";
import { utcMonth } from "./lib/licenseActivity";
import { sealString } from "./lib/sse";
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { server } = await requireInstanceAdmin(ctx);
    const result = licenseStatus(server.licenseKey, Date.now(), server.licenseValidation);
    if (
      result.state === "active" &&
      server.licenseValidation &&
      !server.licenseValidation.billingModel
    ) {
      const members = await ctx.db.query("members").take(server.licenseValidation.seats + 1);
      if (members.length > server.licenseValidation.seats) {
        result.state = "invalid";
        result.note =
          "This installation exceeds the paid seat count. Increase the company subscription before verifying again.";
      }
    }
    return {
      ...result,
      licenseId: server.licenseValidation?.licenseId ?? null,
      billingModel: server.licenseValidation?.billingModel ?? null,
      maskedKey: maskLicenseKey(server.licenseKey),
      tags: server.licenseValidation?.tags ?? [],
      checkedAt: server.licenseValidation?.checkedAt ?? null,
    };
  },
});
export const setKey = mutation({
  args: { key: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { userId, server } = await requireInstanceAdmin(ctx);
    const key = args.key?.trim() || undefined;
    if (key && !isLicenseKey(key))
      throw new ConvexError("Paste an AULORA2 subscription license key");
    await ctx.db.patch(server._id, { licenseKey: key, licenseValidation: undefined });
    await writeAudit(ctx, {
      actorId: userId,
      action: key ? "instance.license.set" : "instance.license.clear",
    });
    if (key) await ctx.scheduler.runAfter(0, internal.licenseActions.refresh, {});
    return { ...licenseStatus(key), maskedKey: maskLicenseKey(key) };
  },
});
export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
  },
});
export const validationInput = internalQuery({
  args: {},
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (!server?.licenseKey || !isLicenseKey(server.licenseKey)) return null;
    return {
      instanceId: server._id,
      key: server.licenseKey,
      members: (await ctx.db.query("members").take(100001)).length,
    };
  },
});
const record = v.object({
  keyHash: v.string(),
  licenseId: v.optional(v.string()),
  billingModel: v.optional(v.literal("monthly-active-users")),
  state: v.union(
    v.literal("active"),
    v.literal("expired"),
    v.literal("invalid"),
    v.literal("unlicensed"),
  ),
  tier: v.union(v.literal("commercial"), v.literal("noncommercial"), v.null()),
  licensee: v.union(v.string(), v.null()),
  issuedAt: v.union(v.number(), v.null()),
  expiresAt: v.union(v.number(), v.null()),
  checkedAt: v.number(),
  validUntil: v.number(),
  note: v.string(),
  tags: v.array(v.string()),
  seats: v.number(),
});
export const saveValidation = internalMutation({
  args: { instanceId: v.id("server"), record },
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.instanceId);
    if (!server?.licenseKey || (await sha256Hex(server.licenseKey)) !== args.record.keyHash) return;
    await ctx.db.patch(server._id, { licenseValidation: args.record });
    if (
      args.record.state === "active" &&
      args.record.licenseId &&
      args.record.billingModel === "monthly-active-users"
    ) {
      const licenseId = args.record.licenseId;
      const month = utcMonth(Date.now());
      const existingKey = await ctx.db
        .query("licenseReportKeys")
        .withIndex("by_license", (q) => q.eq("licenseId", licenseId))
        .unique();
      if (existingKey?.keyHash !== args.record.keyHash) {
        const ciphertext = await sealString(
          { scope: "license-report-key", recordId: licenseId },
          server.licenseKey,
        );
        if (existingKey)
          await ctx.db.patch(existingKey._id, { ciphertext, keyHash: args.record.keyHash });
        else
          await ctx.db.insert("licenseReportKeys", {
            licenseId,
            keyHash: args.record.keyHash,
            ciphertext,
            instanceId: server._id,
          });
      }
      if (
        !(await ctx.db
          .query("licenseUsageMonths")
          .withIndex("by_license_month", (q) => q.eq("licenseId", licenseId).eq("month", month))
          .unique())
      )
        await ctx.db.insert("licenseUsageMonths", { licenseId, month, activeUsers: 0 });
    }
  },
});
