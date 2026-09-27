import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import {
  actorTopPosition,
  assertValidPermissionBits,
  isEveryoneRole,
  requireCanGrant,
  requireRoleManageable,
  requireWorkspaceContext,
} from "./lib/permissions";

interface RoleView {
  readonly id: Doc<"roles">["_id"];
  readonly key: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly position: number;
  readonly permissions: bigint;
  readonly hoisted: boolean;
  readonly mentionable: boolean;
  readonly isEveryone: boolean;
}

function toRoleView(role: Doc<"roles">): RoleView {
  return {
    id: role._id,
    key: role.key ?? null,
    name: role.name,
    color: role.color ?? null,
    position: role.position,
    permissions: role.permissions,
    hoisted: role.hoisted,
    mentionable: role.mentionable,
    isEveryone: isEveryoneRole(role),
  };
}

/** All roles, highest position first. Readable by any signed-in member. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const roles = await ctx.db.query("roles").collect();
    return roles.sort((a, b) => b.position - a.position).map(toRoleView);
  },
});

/**
 * Creates a role below the actor's highest role. A newer role is inserted at
 * `position` (default: just below the actor's top) and existing roles at or
 * above it shift up. `@everyone` never moves from position 0. Nobody can grant
 * a permission they do not hold.
 */
export const create = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    permissions: v.optional(v.int64()),
    hoisted: v.optional(v.boolean()),
    mentionable: v.optional(v.boolean()),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const requested = args.permissions ?? 0n;
    assertValidPermissionBits(requested);
    requireCanGrant(context, requested);

    const roles = await ctx.db.query("roles").collect();
    const maxPosition = roles.reduce((max, role) => Math.max(max, role.position), -1);

    let insertPosition: number;
    if (context.isOwner) {
      insertPosition = args.position ?? maxPosition + 1;
    } else {
      const top = actorTopPosition(context);
      if (top <= 0) {
        throw new ConvexError("No role position below your highest role");
      }
      insertPosition = Math.min(args.position ?? top, top);
    }
    if (insertPosition < 0) {
      throw new ConvexError("Role position cannot be negative");
    }
    if (insertPosition === 0) {
      insertPosition = 1;
    }

    for (const role of roles) {
      if (isEveryoneRole(role)) {
        continue;
      }
      if (role.position >= insertPosition) {
        await ctx.db.patch(role._id, { position: role.position + 1 });
      }
    }

    const roleId = await ctx.db.insert("roles", {
      name: args.name,
      position: insertPosition,
      permissions: requested,
      hoisted: args.hoisted ?? false,
      mentionable: args.mentionable ?? false,
      ...(args.color !== undefined ? { color: args.color } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "role.create",
      targetId: roleId,
      meta: JSON.stringify({ name: args.name, position: insertPosition }),
    });
    return roleId;
  },
});

/**
 * Updates a manageable role's name, color, display flags or permissions.
 */
export const update = mutation({
  args: {
    roleId: v.id("roles"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.optional(v.int64()),
    hoisted: v.optional(v.boolean()),
    mentionable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const role = await ctx.db.get(args.roleId);
    if (role === null) {
      throw new ConvexError("Role not found");
    }
    requireRoleManageable(context, role);

    if (args.permissions !== undefined) {
      assertValidPermissionBits(args.permissions);
      requireCanGrant(context, args.permissions);
    }

    await ctx.db.patch(args.roleId, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.color !== undefined ? { color: args.color } : {}),
      ...(args.permissions !== undefined ? { permissions: args.permissions } : {}),
      ...(args.hoisted !== undefined ? { hoisted: args.hoisted } : {}),
      ...(args.mentionable !== undefined ? { mentionable: args.mentionable } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "role.update",
      targetId: args.roleId,
      meta: JSON.stringify({ changed: Object.keys(args).filter((key) => key !== "roleId") }),
    });
    return null;
  },
});

/**
 * Deletes a manageable role and detaches it from every member. `@everyone`
 * cannot be deleted.
 */
export const remove = mutation({
  args: { roleId: v.id("roles") },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const role = await ctx.db.get(args.roleId);
    if (role === null) {
      throw new ConvexError("Role not found");
    }
    if (isEveryoneRole(role)) {
      throw new ConvexError("The @everyone role cannot be deleted");
    }
    requireRoleManageable(context, role);

    const roleRef = role.key ?? role._id;
    const members = await ctx.db.query("members").collect();
    for (const member of members) {
      if (member.roleIds.includes(roleRef)) {
        await ctx.db.patch(member._id, {
          roleIds: member.roleIds.filter((roleId) => roleId !== roleRef),
        });
      }
    }
    await ctx.db.delete(args.roleId);
    await writeAudit(ctx, {
      actorId: userId,
      action: "role.delete",
      targetId: args.roleId,
      meta: JSON.stringify({ name: role.name }),
    });
    return null;
  },
});

/**
 * Applies explicit positions sent by the role editor. Each role must be
 * manageable and `@everyone` must remain at position 0.
 */
export const reorder = mutation({
  args: {
    positions: v.array(v.object({ roleId: v.id("roles"), position: v.number() })),
  },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const roleDocs = await ctx.db.query("roles").collect();
    const byId = new Map(roleDocs.map((role) => [role._id as string, role]));
    const actorTop = actorTopPosition(context);

    for (const entry of args.positions) {
      const role = byId.get(entry.roleId);
      if (role === undefined) {
        throw new ConvexError("Role not found");
      }
      if (entry.position < 0) {
        throw new ConvexError("Role position cannot be negative");
      }
      requireRoleManageable(context, role);
      if (!context.isOwner && entry.position >= actorTop) {
        throw new ConvexError("Role is not below your highest role");
      }
      if (isEveryoneRole(role) && entry.position !== 0) {
        throw new ConvexError("@everyone must stay at position 0");
      }
    }

    for (const entry of args.positions) {
      await ctx.db.patch(entry.roleId, { position: entry.position });
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "role.reorder",
      meta: JSON.stringify({ count: args.positions.length }),
    });
    return null;
  },
});
