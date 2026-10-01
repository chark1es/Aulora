import { Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { requireWorkspacePermission } from "./lib/permissions";

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
    const members = await ctx.db.query("members").collect();
    const nicknameByUser = new Map(members.map((member) => [member.userId, member.nickname]));

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
