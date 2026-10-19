import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { DEFAULT_INSTANCE_SETTINGS } from "./lib/instance";
import { syncMemberRoles } from "./lib/memberRoles";
import { upsertThreadParticipant } from "./lib/threadParticipants";

/** Members processed per backfill page before rescheduling. */
const MEMBER_BACKFILL_BATCH = 500;
/** Members whose role links are synced per backfill page. */
const MEMBER_ROLE_BACKFILL_BATCH = 200;
/** Messages scanned per thread-participant backfill page. */
const THREAD_PARTICIPANT_BACKFILL_BATCH = 200;
/** Rows counted per instance-counter backfill page. */
const INSTANCE_COUNTER_BATCH = 200;

type InstanceCounterTotals = {
  files: number;
  fileBytes: number;
  channels: number;
  devices: number;
};

/** Writes the recounted totals onto the singleton settings row. */
async function writeInstanceCounters(
  ctx: MutationCtx,
  totals: InstanceCounterTotals,
): Promise<void> {
  const row = await ctx.db.query("instanceSettings").first();
  if (row === null) {
    await ctx.db.insert("instanceSettings", {
      storageQuotaBytes: DEFAULT_INSTANCE_SETTINGS.storageQuotaBytes,
      maxUploadBytes: DEFAULT_INSTANCE_SETTINGS.maxUploadBytes,
      pushRelayEnabled: DEFAULT_INSTANCE_SETTINGS.pushRelayEnabled,
      backupsEnabled: DEFAULT_INSTANCE_SETTINGS.backupsEnabled,
      fileCount: totals.files,
      fileBytes: totals.fileBytes,
      channelCount: totals.channels,
      deviceCount: totals.devices,
    });
    return;
  }
  await ctx.db.patch(row._id, {
    fileCount: totals.files,
    fileBytes: totals.fileBytes,
    channelCount: totals.channels,
    deviceCount: totals.devices,
  });
}

/**
 * Idempotent migration: recount `members` and store the total on the singleton
 * `server` row so the license seat/MAU check no longer has to read up to 100k
 * member rows every 30 minutes. Run it while membership is quiet and re-run it
 * if members joined or left mid-backfill: the final write is a snapshot, so a
 * concurrent change between pages can leave the stored count slightly stale.
 * Safe to re-run: a run with no cursor recounts from zero and overwrites the
 * existing value, paging through members and rescheduling while more remain.
 */
export const backfillMemberCount = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    counted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server === null) {
      return null;
    }
    const page = await ctx.db
      .query("members")
      .paginate({ numItems: MEMBER_BACKFILL_BATCH, cursor: args.cursor ?? null });
    const counted = (args.counted ?? 0) + page.page.length;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillMemberCount, {
        cursor: page.continueCursor,
        counted,
      });
      return null;
    }
    await ctx.db.patch(server._id, { memberCount: counted });
    return null;
  },
});

/**
 * Idempotent migration: seeds the `memberRoles` reverse index from
 * `members.roleIds`, which stays authoritative for reads. Safe to re-run; each
 * run rewrites the links for the members it pages over. Reschedules while more
 * members remain.
 */
export const backfillMemberRoles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("members")
      .paginate({ numItems: MEMBER_ROLE_BACKFILL_BATCH, cursor: args.cursor ?? null });
    for (const member of page.page) {
      await syncMemberRoles(ctx, member.userId, member.roleIds, member.joinedAt);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillMemberRoles, {
        cursor: page.continueCursor,
      });
      return null;
    }
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { memberRolesBackfilled: true });
    }
    return null;
  },
});

/**
 * Idempotent migration: seeds `threadParticipants` from existing threads —
 * each reply's author and mentions, plus each root's recent repliers and own
 * mentions. Paged over `messages` and rescheduled while more remain, so it
 * never scans the whole table in one transaction. Safe to re-run: the upsert
 * only moves `lastReplyAt` forward and ORs `mentioned`.
 */
export const backfillThreadParticipants = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("messages")
      .paginate({ numItems: THREAD_PARTICIPANT_BACKFILL_BATCH, cursor: args.cursor ?? null });
    for (const message of page.page) {
      // A reply records its author and anyone it mentions against the root.
      // The root's `replyParticipantIds` is capped, so it cannot replace this.
      if (message.threadRootId !== undefined) {
        await upsertThreadParticipant(ctx, {
          userId: message.authorId,
          threadRootId: message.threadRootId,
          channelId: message.channelId,
          at: message._creationTime,
          mentioned: false,
          participated: true,
        });
        for (const userId of message.mentionUserIds) {
          await upsertThreadParticipant(ctx, {
            userId,
            threadRootId: message.threadRootId,
            channelId: message.channelId,
            at: message._creationTime,
            mentioned: true,
            participated: false,
          });
        }
        continue;
      }
      const at = message.lastReplyAt ?? message._creationTime;
      for (const userId of message.replyParticipantIds ?? []) {
        await upsertThreadParticipant(ctx, {
          userId,
          threadRootId: message._id,
          channelId: message.channelId,
          at,
          mentioned: false,
          participated: true,
        });
      }
      for (const userId of message.mentionUserIds) {
        await upsertThreadParticipant(ctx, {
          userId,
          threadRootId: message._id,
          channelId: message.channelId,
          at: message._creationTime,
          mentioned: true,
          participated: false,
        });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillThreadParticipants, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/** Schedules the next page of the instance-counter backfill. */
async function scheduleNextCounterPage(
  ctx: MutationCtx,
  totals: InstanceCounterTotals,
  stage: number,
  cursor: string | null,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.maintenance.backfillInstanceCounters, {
    ...totals,
    stage,
    ...(cursor === null ? {} : { cursor }),
  });
}

/**
 * Idempotent migration: seeds the maintained instance counters the admin
 * overview reads (`instanceSettings.fileCount`/`fileBytes`/`channelCount`/
 * `deviceCount`) from the existing tables. Pages one table at a time (files →
 * channels → devices) with a running total, rescheduling between pages, then
 * writes the totals in a final page. Safe to re-run: it overwrites the counters
 * with fresh totals, creating the singleton settings row with defaults when
 * none exists.
 */
export const backfillInstanceCounters = internalMutation({
  args: {
    /** 0 = files, 1 = channels, 2 = devices. */
    stage: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    files: v.optional(v.number()),
    fileBytes: v.optional(v.number()),
    channels: v.optional(v.number()),
    devices: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stage = args.stage ?? 0;
    const totals = {
      files: args.files ?? 0,
      fileBytes: args.fileBytes ?? 0,
      channels: args.channels ?? 0,
      devices: args.devices ?? 0,
    };

    if (stage === 0) {
      const page = await ctx.db
        .query("files")
        .paginate({ numItems: INSTANCE_COUNTER_BATCH, cursor: args.cursor ?? null });
      totals.files += page.page.length;
      for (const file of page.page) {
        totals.fileBytes += file.sizeBytes;
      }
      const next = page.isDone ? 1 : 0;
      await scheduleNextCounterPage(ctx, totals, next, page.isDone ? null : page.continueCursor);
      return null;
    }

    if (stage === 1) {
      const page = await ctx.db
        .query("channels")
        .paginate({ numItems: INSTANCE_COUNTER_BATCH, cursor: args.cursor ?? null });
      totals.channels += page.page.length;
      const next = page.isDone ? 2 : 1;
      await scheduleNextCounterPage(ctx, totals, next, page.isDone ? null : page.continueCursor);
      return null;
    }

    const page = await ctx.db
      .query("devices")
      .paginate({ numItems: INSTANCE_COUNTER_BATCH, cursor: args.cursor ?? null });
    totals.devices += page.page.length;
    if (!page.isDone) {
      await scheduleNextCounterPage(ctx, totals, 2, page.continueCursor);
      return null;
    }

    await writeInstanceCounters(ctx, totals);
    return null;
  },
});
