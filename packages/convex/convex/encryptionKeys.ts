import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, query } from "./_generated/server";
import { getEkmSettings } from "./lib/ekm";
import { getEncryptionSettings } from "./lib/env";
import { requireInstanceAdmin } from "./lib/instance";
import { clearKeyCache, encryptionConfigured, primeMasterKey } from "./lib/sse";

/**
 * Key-version registry for the server-side encryption layer.
 *
 * Rows never hold key material — only which version exists, who guarded it and
 * whether it is still active. `openString`/`openBytes` read the version from a
 * sealed value's own header, so rotation does not require re-encrypting
 * history in one pass: older versions stay readable while a background sweep
 * can re-seal them at leisure.
 */

/** Operator/admin status for the encryption surface. Never key material. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const env = process.env;
    const settings = getEkmSettings(env);
    const versions = await ctx.db.query("encryptionKeys").withIndex("by_key_version").collect();
    const active = versions.find((row) => row.status === "active");
    return {
      activeKeyVersion: active?.keyVersion ?? settings.keyVersion,
      configured: encryptionConfigured(env),
      provider: settings.provider,
      kekId: settings.kekId,
      versions: versions.map((row) => ({
        keyVersion: row.keyVersion,
        provider: row.provider,
        kekId: row.kekId,
        status: row.status,
        createdAt: row.createdAt,
        retiredAt: row.retiredAt ?? null,
      })),
    };
  },
});

/**
 * Upserts one key-version row. Marking a version active retires every other
 * active version in the same transaction, so rotation stays consistent.
 */
export const register = internalMutation({
  args: {
    keyVersion: v.string(),
    provider: v.string(),
    kekId: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    createdAt: v.optional(v.number()),
    retiredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const keyVersion = args.keyVersion.trim();
    if (keyVersion.length === 0 || args.provider.trim().length === 0) {
      throw new ConvexError("Key version and provider are required");
    }
    const createdAt = args.createdAt ?? Date.now();
    if (args.status === "active") {
      const rows = await ctx.db.query("encryptionKeys").withIndex("by_key_version").collect();
      for (const row of rows) {
        if (row.keyVersion !== keyVersion && row.status === "active") {
          await ctx.db.patch(row._id, {
            status: "retired",
            retiredAt: args.retiredAt ?? createdAt,
          });
        }
      }
    }
    const existing = await ctx.db
      .query("encryptionKeys")
      .withIndex("by_key_version", (q) => q.eq("keyVersion", keyVersion))
      .unique();
    if (existing === null) {
      return await ctx.db.insert("encryptionKeys", {
        keyVersion,
        provider: args.provider,
        kekId: args.kekId,
        status: args.status,
        createdAt,
        ...(args.retiredAt !== undefined ? { retiredAt: args.retiredAt } : {}),
      });
    }
    await ctx.db.patch(existing._id, {
      provider: args.provider,
      kekId: args.kekId,
      status: args.status,
      ...(args.retiredAt !== undefined ? { retiredAt: args.retiredAt } : {}),
    });
    return existing._id;
  },
});

/**
 * Rotates to the key version configured in the deployment environment: primes
 * the new master key (the only network step), registers it as active and
 * retires older versions. Existing content is re-encrypted lazily.
 *
 * Internal: rotation is an operator/deployment action (`convex run` with the
 * admin key), never a client-callable endpoint, because it clears the key cache
 * and mutates the key-version registry.
 */
export const rotate = internalAction({
  args: {},
  handler: async (ctx) => {
    const env = process.env;
    const settings = getEkmSettings(env);
    clearKeyCache();
    await primeMasterKey({ env });
    await ctx.runMutation(internal.encryptionKeys.register, {
      keyVersion: settings.keyVersion,
      provider: settings.provider,
      kekId: settings.kekId,
      status: "active",
    });
    return {
      keyVersion: settings.keyVersion,
      provider: settings.provider,
      kekId: settings.kekId,
    };
  },
});

/**
 * Fetches the current master key for remote providers. Remote EKM unwraps need
 * a network round trip, so a cron keeps the key cached for queries/mutations.
 * The local provider derives its key on demand and is a no-op here.
 */
export const prime = internalAction({
  args: {},
  handler: async () => {
    const settings = getEkmSettings(process.env);
    if (settings.provider === "local") {
      return null;
    }
    await primeMasterKey({ env: process.env });
    return null;
  },
});

/** Public-safe encryption description for the well-known/config surface. */
export const info = query({
  args: {},
  handler: () => {
    const env = process.env;
    const settings = getEkmSettings(env);
    const encryption = getEncryptionSettings(env);
    return {
      serverSideEncryption: true as const,
      algorithm: "AES-256-GCM" as const,
      enabled: encryption.enabled,
      keyVersion: settings.keyVersion,
      provider: settings.provider,
    };
  },
});
