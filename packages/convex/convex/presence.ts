import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { recordLicenseActivity } from "./lib/licenseActivity";
import { requireMember } from "./lib/permissions";
import { openContentOptional } from "./lib/sealed";
import { sealString } from "./lib/sse";

export const PRESENCE_HEARTBEAT_MS = 30_000;
/** Older than this marks an `online` session idle. */
export const PRESENCE_IDLE_MS = 60_000;
/** Older than this marks any session offline. */
export const PRESENCE_OFFLINE_MS = 150_000;
/** Presence rows examined per sweep invocation before rescheduling. */
const PRESENCE_SWEEP_BATCH = 500;
/** Presence rows deleted per prune run before rescheduling. */
const PRESENCE_PRUNE_BATCH = 500;
/**
 * Presence rows not heartbeated within this window are dropped outright. The
 * staleness sweep already marks them offline long before this; the prune only
 * reclaims storage for members who are gone.
 */
export const PRESENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Hard ceiling on ids one `getMany` call will look up, after de-duplication.
 * Clients scope presence to a channel's members/view; the cap stops a
 * pathological id list from fanning out into unbounded index reads.
 */
const PRESENCE_GET_MANY_MAX = 300;

const presenceStatusValidator = v.union(
  v.literal("online"),
  v.literal("idle"),
  v.literal("dnd"),
  v.literal("offline"),
);

type PresenceStatus = "online" | "idle" | "dnd" | "offline";

const CUSTOM_STATUS_CONTEXT = { scope: "presence.status" } as const;

/** The row shape every presence read returns; custom status opened inline. */
async function toPresenceRow(row: Doc<"presence">) {
  return {
    userId: row.userId,
    status: row.status,
    customStatus: await openContentOptional(CUSTOM_STATUS_CONTEXT, row.customStatusCiphertext),
    lastHeartbeat: row.lastHeartbeat,
  };
}

interface PresencePatch {
  readonly status?: PresenceStatus;
  /** Sealed custom status; `undefined` means "no change to the field". */
  readonly customStatusCiphertext?: string | undefined;
  /** True when the caller explicitly set (or cleared) the custom status. */
  readonly setCustomStatus?: boolean;
  /**
   * The {@link PresenceRow.manual} flag to store. `undefined` leaves the field
   * untouched (used when a caller should not change automatic/manual state).
   */
  readonly manual?: boolean;
}

async function upsertPresence(
  ctx: MutationCtx,
  userId: string,
  patch: PresencePatch,
  now: number,
): Promise<{ status: PresenceStatus; lastHeartbeat: number }> {
  const existing = await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const status = patch.status ?? existing?.status ?? "online";
  const lastOnlineAt =
    status !== "offline"
      ? now
      : (existing?.lastOnlineAt ??
        (existing !== null && existing.status !== "offline" ? existing.lastHeartbeat : undefined));
  const setCustomStatus = patch.setCustomStatus === true;
  const customStatusCiphertext = setCustomStatus
    ? patch.customStatusCiphertext
    : existing?.customStatusCiphertext;

  if (existing === null) {
    await ctx.db.insert("presence", {
      userId,
      status,
      lastHeartbeat: now,
      ...(lastOnlineAt !== undefined ? { lastOnlineAt } : {}),
      ...(patch.manual !== undefined ? { manual: patch.manual } : {}),
      ...(customStatusCiphertext !== undefined ? { customStatusCiphertext } : {}),
    });
  } else {
    await ctx.db.patch(existing._id, {
      status,
      lastHeartbeat: now,
      ...(lastOnlineAt !== undefined ? { lastOnlineAt } : {}),
      ...(patch.manual !== undefined ? { manual: patch.manual } : {}),
      ...(setCustomStatus ? { customStatusCiphertext } : {}),
    });
  }
  return { status, lastHeartbeat: now };
}

/**
 * Presence heartbeat (clients call every ~30s). Optionally updates the status;
 * does not change the custom status. A manually chosen status (anything other
 * than `online`) is preserved: the heartbeat only refreshes its timestamp.
 */
export const heartbeat = mutation({
  args: { status: v.optional(presenceStatusValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const member = await requireMember(ctx, userId);
    // Reuse the membership `requireMember` already resolved instead of reading
    // the member row again inside the licence-activity recorder.
    await recordLicenseActivity(ctx, userId, Date.now(), { isMember: member !== null });
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // A deliberate status is never overwritten by a heartbeat; only the
    // liveness timestamp moves so the row stays out of the offline sweep.
    if (existing?.manual === true) {
      await ctx.db.patch(existing._id, {
        lastHeartbeat: now,
        ...(existing.status !== "offline" ? { lastOnlineAt: now } : {}),
      });
      return { status: existing.status, lastHeartbeat: now };
    }
    return await upsertPresence(
      ctx,
      userId,
      { status: args.status ?? "online", manual: false },
      now,
    );
  },
});

/**
 * Sets a deliberate status and an optional custom status (sealed server-side).
 * Any status other than `online` marks the row manual so it survives both
 * heartbeats and the staleness sweep; setting `online` clears the flag so
 * automatic behaviour resumes.
 */
export const setStatus = mutation({
  args: {
    status: presenceStatusValidator,
    customStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    await recordLicenseActivity(ctx, userId);
    const customStatusProvided = args.customStatus !== undefined;
    const trimmed = args.customStatus?.trim() ?? "";
    const customStatusCiphertext =
      customStatusProvided && trimmed.length > 0
        ? await sealString(CUSTOM_STATUS_CONTEXT, trimmed)
        : undefined;
    return await upsertPresence(
      ctx,
      userId,
      {
        status: args.status,
        manual: args.status !== "online",
        setCustomStatus: customStatusProvided,
        customStatusCiphertext,
      },
      Date.now(),
    );
  },
});

/** Lists presence for every user that has reported it. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const rows = await ctx.db.query("presence").collect();
    return await Promise.all(rows.map((row) => toPresenceRow(row)));
  },
});

/** Single user's presence, or `null`. */
export const get = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const row = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (row === null) {
      return null;
    }
    return await toPresenceRow(row);
  },
});

/**
 * Scoped presence for a set of user ids — the replacement for the full
 * {@link list} read. Ids are de-duplicated and capped at
 * {@link PRESENCE_GET_MANY_MAX}; each remaining id is looked up through the
 * `by_user` index rather than collecting the table. Rows are returned in the
 * caller's id order (duplicates dropped), each with the exact shape
 * {@link list} returns. Ids with no presence row are omitted.
 */
export const getMany = query({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const ids = [...new Set(args.userIds)].slice(0, PRESENCE_GET_MANY_MAX);
    const rows = await Promise.all(
      ids.map((id) =>
        ctx.db
          .query("presence")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .unique(),
      ),
    );
    return await Promise.all(rows.filter((row) => row !== null).map((row) => toPresenceRow(row)));
  },
});

/**
 * Cron hook: moves stale `online` sessions to `idle`, then any stale session to
 * `offline`. Rows the user set manually are skipped entirely so a deliberate
 * `dnd`/`idle`/`offline` survives inactivity.
 *
 * The sweep reads only rows past the idle threshold via the `by_lastHeartbeat`
 * index instead of collecting the whole `presence` table, so the cost scales
 * with the number of stale sessions, not the workspace size. Rows are swept in
 * index (oldest-heartbeat first) pages of {@link PRESENCE_SWEEP_BATCH}; while a
 * page is full a follow-up run continues from the returned cursor. Patching a
 * row's `status` does not move `lastHeartbeat`, so a cursor (rather than a
 * re-scan from the front) is what gives the drain forward progress.
 */
export const sweepStale = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const idleCutoff = now - PRESENCE_IDLE_MS;
    const result = await ctx.db
      .query("presence")
      .withIndex("by_lastHeartbeat", (q) => q.lt("lastHeartbeat", idleCutoff))
      .paginate({ numItems: PRESENCE_SWEEP_BATCH, cursor: args.cursor ?? null });
    let changed = 0;
    for (const row of result.page) {
      if (row.manual === true) {
        continue;
      }
      const age = now - row.lastHeartbeat;
      if (age >= PRESENCE_OFFLINE_MS) {
        if (row.status !== "offline") {
          await ctx.db.patch(row._id, { status: "offline" });
          changed += 1;
        }
      } else if (age >= PRESENCE_IDLE_MS && row.status === "online") {
        await ctx.db.patch(row._id, { status: "idle" });
        changed += 1;
      }
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.presence.sweepStale, {
        cursor: result.continueCursor,
      });
    }
    return changed;
  },
});

/**
 * Cron hook: deletes presence rows last heartbeated longer than
 * {@link PRESENCE_RETENTION_MS} ago, reclaiming storage for members who left.
 * Reads only rows past the cutoff via `by_lastHeartbeat` and reschedules while
 * a batch is full. Rows inside the retention window (including any a user could
 * still be sending heartbeats for) are never deleted.
 */
export const pruneStalePresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_RETENTION_MS;
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_lastHeartbeat", (q) => q.lt("lastHeartbeat", cutoff))
      .take(PRESENCE_PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === PRESENCE_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.presence.pruneStalePresence, {});
    }
    return rows.length;
  },
});
