import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { verifySetupToken } from "./lib/crypto";
import { loadInstanceSettings, requireInstanceAdmin } from "./lib/instance";

/**
 * Backup bookkeeping. Convex cannot run `convex export` or `pg_dump` itself, so
 * the nightly cron and the manual control only record the *intent*; the outside
 * backup runner (`infra/docker/backup`) performs the export and upload and
 * reports the result back through `record`. Rows hold no key material or data.
 */

const NIGHTLY_SCHEDULE = "0 3 * * *";

/** Recent backup runs, newest first, for the instance admin panel. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const rows = await ctx.db.query("backups").withIndex("by_started").order("desc").take(50);
    return rows.map((row) => ({
      id: row._id,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt ?? null,
      sizeBytes: row.sizeBytes ?? null,
      location: row.location ?? null,
      message: row.message ?? null,
    }));
  },
});

/** Backup policy plus whether a runner is configured. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const settings = await loadInstanceSettings(ctx);
    const lastRun =
      (await ctx.db.query("backups").withIndex("by_started").order("desc").first()) ?? null;
    return {
      enabled: settings.backupsEnabled,
      runnerConfigured:
        process.env.BACKUP_TOKEN !== undefined && process.env.BACKUP_TOKEN.trim().length > 0,
      schedule: NIGHTLY_SCHEDULE,
      lastRun,
    };
  },
});

/** Queues a manual backup. The runner picks it up or the operator runs it. */
export const request = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireInstanceAdmin(ctx);
    const startedAt = Date.now();
    const id = await ctx.db.insert("backups", {
      trigger: "manual",
      status: "requested",
      startedAt,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "instance.backup.request",
      targetId: id,
    });
    return id;
  },
});

function clamp(value: string | undefined, max: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

/**
 * Records the outcome reported by the backup runner. Gated by the one-time
 * `BACKUP_TOKEN` deployment secret with a constant-time comparison, so the
 * runner needs no user session.
 */
export const record = mutation({
  args: {
    token: v.string(),
    status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    sizeBytes: v.optional(v.number()),
    location: v.optional(v.string()),
    message: v.optional(v.string()),
    trigger: v.optional(v.union(v.literal("cron"), v.literal("manual"))),
  },
  handler: async (ctx, args) => {
    if (!verifySetupToken(args.token, process.env.BACKUP_TOKEN)) {
      throw new Error("Invalid backup token");
    }
    const sizeBytes =
      args.sizeBytes !== undefined && Number.isFinite(args.sizeBytes) && args.sizeBytes >= 0
        ? Math.floor(args.sizeBytes)
        : undefined;
    const location = clamp(args.location, 300);
    const message = clamp(args.message, 500);
    const id = await ctx.db.insert("backups", {
      trigger: args.trigger ?? "cron",
      status: args.status,
      startedAt: args.startedAt,
      ...(args.finishedAt !== undefined ? { finishedAt: args.finishedAt } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(message !== undefined ? { message } : {}),
    });
    return { ok: true as const, id };
  },
});

/**
 * Cron entry point: records the nightly intent unless backups are disabled.
 * The actual export + dump + upload is the backup runner's job.
 */
export const nightly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const settings = await loadInstanceSettings(ctx);
    if (!settings.backupsEnabled) {
      return null;
    }
    const id = await ctx.db.insert("backups", {
      trigger: "cron",
      status: "requested",
      startedAt: Date.now(),
    });
    return id;
  },
});
