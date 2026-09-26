import { Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspacePermission } from "./lib/permissions";

/**
 * Paginated audit log, newest first. Gated by `ViewAuditLog`. Each row records
 * an opaque action string, an actor, an optional target and JSON metadata; no
 * message plaintext, key material or invite code is ever written here.
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
    return {
      ...result,
      page: result.page.map((row) => ({
        id: row._id,
        actorId: row.actorId,
        action: row.action,
        targetId: row.targetId ?? null,
        meta: row.meta ?? null,
        at: row.at,
      })),
    };
  },
});
