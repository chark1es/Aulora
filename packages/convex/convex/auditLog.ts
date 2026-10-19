import { Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { requireWorkspacePermission } from "./lib/permissions";

/** Audit rows deleted per prune run before rescheduling. */
const AUDIT_PRUNE_BATCH = 500;

/**
 * Retention for the audit log. Moderation/admin history is kept for six months
 * and then dropped; a daily cron enforces it via the `by_at` index. Documented
 * constant so the policy is explicit rather than implied.
 */
export const AUDIT_LOG_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Paginated audit log, newest first. Gated by `ViewAuditLog`. Each row records
 * an opaque action string, an actor, an optional target and JSON metadata; no
 * message plaintext, key material or invite code is ever written here. Display
 * names are resolved so the UI can render a human sentence; unknown ids come
 * back as an empty string.
 */
export const list = query({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, Permission.ViewAuditLog);
    const result = await ctx.db
      .query("auditLog")
      .withIndex("by_at")
      .order("desc")
      .paginate(args.paginationOpts ?? { numItems: 50, cursor: null });

    const ids = new Set<string>();
    for (const row of result.page) {
      ids.add(row.actorId);
      if (row.targetId !== undefined) {
        ids.add(row.targetId);
      }
    }
    const names = await accountNames(ctx, [...ids]);
    // Resolve nicknames only for the ids on this page, not every member.
    const nicknameByUser = new Map<string, string | undefined>();
    for (const id of ids) {
      const member = await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", id))
        .unique();
      if (member !== null) {
        nicknameByUser.set(id, member.nickname);
      }
    }

    const resolveName = (id: string | undefined): string => {
      if (id === undefined) {
        return "";
      }
      const account = names.get(id);
      if (account !== undefined && account !== null && account.length > 0) {
        return account;
      }
      const nickname = nicknameByUser.get(id);
      return nickname !== undefined && nickname !== null && nickname.length > 0 ? nickname : "";
    };

    return {
      ...result,
      page: result.page.map((row) => ({
        id: row._id,
        actorId: row.actorId,
        actorName: resolveName(row.actorId),
        action: row.action,
        targetId: row.targetId ?? null,
        targetName: resolveName(row.targetId),
        meta: row.meta ?? null,
        at: row.at,
      })),
    };
  },
});

/**
 * Cron hook: drops audit rows older than {@link AUDIT_LOG_RETENTION_MS}.
 * Reads only rows past the cutoff via `by_at` (never a full scan) and drains a
 * backlog by rescheduling while a batch is full. Rows inside the retention
 * window are never touched. Ongoing reads (`list`) are unchanged.
 */
export const pruneAuditLog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - AUDIT_LOG_RETENTION_MS;
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_at", (q) => q.lt("at", cutoff))
      .take(AUDIT_PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === AUDIT_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.auditLog.pruneAuditLog, {});
    }
    return rows.length;
  },
});
