import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
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
      ...(customStatusCiphertext !== undefined ? { customStatusCiphertext } : {}),
    });
  } else {
    await ctx.db.patch(existing._id, {
      status,
      lastHeartbeat: now,
      ...(setCustomStatus ? { customStatusCiphertext } : {}),
    });
  }
  return { status, lastHeartbeat: now };
}

/**
 * Presence heartbeat (clients call every ~30s). Optionally updates the status;
 * does not change the custom status.
 */
export const heartbeat = mutation({
  args: { status: v.optional(presenceStatusValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const patch: PresencePatch = args.status !== undefined ? { status: args.status } : {};
    return await upsertPresence(ctx, userId, patch, Date.now());
  },
});

/** Sets a deliberate status and an optional custom status (sealed server-side). */
export const setStatus = mutation({
  args: {
    status: presenceStatusValidator,
    customStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const trimmed = args.customStatus?.trim() ?? "";
    const customStatusCiphertext =
      trimmed.length > 0 ? await sealString(CUSTOM_STATUS_CONTEXT, trimmed) : undefined;
    return await upsertPresence(
      ctx,
      userId,
      { status: args.status, setCustomStatus: true, customStatusCiphertext },
      Date.now(),
    );
  },
});

/** Lists presence for every user that has reported it. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
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
    await requireAuth(ctx);
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
 * `offline`. Deliberate `dnd` is preserved until the offline threshold.
 */
export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("presence").collect();
    let changed = 0;
    for (const row of rows) {
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
