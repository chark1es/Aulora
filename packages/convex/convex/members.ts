import { EVERYONE_ROLE_ID } from "@aulora/core";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

async function findRoleByName(ctx: MutationCtx, name: string): Promise<Doc<"roles"> | null> {
  const roles = await ctx.db.query("roles").collect();
  const match = roles.find((role) => role.name === name || role.key === name);
  return match ?? null;
}

/**
 * Ensures the user has an Aulora member record carrying `@everyone`, then
 * attaches the roles mapped from an IdP group claim. Missing roles are created
 * with no permissions, so an operator can grant them afterwards.
 */
export const attachRolesFromAuth = internalMutation({
  args: {
    userId: v.string(),
    roleNames: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const roleIds = new Set<string>([EVERYONE_ROLE_ID]);
    if (existing !== null) {
      for (const roleId of existing.roleIds) {
        roleIds.add(roleId);
      }
    }

    for (const name of args.roleNames ?? []) {
      const role = await findRoleByName(ctx, name);
      if (role !== null) {
        roleIds.add(role.key ?? role._id);
        continue;
      }
      const allRoles = await ctx.db.query("roles").collect();
      const position = allRoles.reduce((max, item) => Math.max(max, item.position), 0) + 1;
      const createdId = await ctx.db.insert("roles", {
        name,
        position,
        permissions: 0n,
        hoisted: false,
        mentionable: false,
      });
      roleIds.add(createdId);
    }

    if (existing === null) {
      await ctx.db.insert("members", {
        userId: args.userId,
        roleIds: [...roleIds],
        joinedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, { roleIds: [...roleIds] });
    }
    return null;
  },
});
