import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireMember } from "./lib/permissions";
import { openContentOptional } from "./lib/sealed";
import { sealString } from "./lib/sse";

export const PRESENCE_HEARTBEAT_MS = 30_000;
/** Older than this marks an `online` session idle. */
export const PRESENCE_IDLE_MS = 60_000;
/** Older than this marks any session offline. */
export const PRESENCE_OFFLINE_MS = 150_000;

const presenceStatusValidator = v.union(
  v.literal("online"),
  v.literal("idle"),
  v.literal("dnd"),
  v.literal("offline"),
);

type PresenceStatus = "online" | "idle" | "dnd" | "offline";

const CUSTOM_STATUS_CONTEXT = { scope: "presence.status" } as const;

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
  const setCustomStatus = patch.setCustomStatus === true;
  const customStatusCiphertext = setCustomStatus
    ? patch.customStatusCiphertext
    : existing?.customStatusCiphertext;

  if (existing === null) {
    await ctx.db.insert("presence", {
      userId,
      status,
      lastHeartbeat: now,
      ...(patch.manual !== undefined ? { manual: patch.manual } : {}),
      ...(customStatusCiphertext !== undefined ? { customStatusCiphertext } : {}),
    });
  } else {
    await ctx.db.patch(existing._id, {
      status,
      lastHeartbeat: now,
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
    await requireMember(ctx, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // A deliberate status is never overwritten by a heartbeat; only the
    // liveness timestamp moves so the row stays out of the offline sweep.
    if (existing?.manual === true) {
      await ctx.db.patch(existing._id, { lastHeartbeat: now });
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
    return await Promise.all(
      rows.map(async (row) => ({
        userId: row.userId,
        status: row.status,
        customStatus: await openContentOptional(CUSTOM_STATUS_CONTEXT, row.customStatusCiphertext),
        lastHeartbeat: row.lastHeartbeat,
      })),
    );
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
    return {
      userId: row.userId,
      status: row.status,
      customStatus: await openContentOptional(CUSTOM_STATUS_CONTEXT, row.customStatusCiphertext),
      lastHeartbeat: row.lastHeartbeat,
    };
  },
});

/**
 * Cron hook: moves stale `online` sessions to `idle`, then any stale session to
 * `offline`. Rows the user set manually are skipped entirely so a deliberate
 * `dnd`/`idle`/`offline` survives inactivity.
 */
export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("presence").collect();
    let changed = 0;
    for (const row of rows) {
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
    return changed;
  },
});
