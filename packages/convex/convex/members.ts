import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import {
  memberDeltaRemovals,
  mlsSignal,
  requireCanGrant,
  requireModerator,
  requireRoleManageable,
  requireWorkspaceContext,
  requireWorkspacePermission,
} from "./lib/permissions";

type ReadCtx = QueryCtx | MutationCtx;

async function findRoleByName(ctx: MutationCtx, name: string): Promise<Doc<"roles"> | null> {
  const roles = await ctx.db.query("roles").collect();
  const match = roles.find((role) => role.name === name || role.key === name);
  return match ?? null;
}

async function requireMember(ctx: ReadCtx, userId: string): Promise<Doc<"members">> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (member === null) {
    throw new ConvexError("Member not found");
  }
  return member;
}

async function detachFromChannels(ctx: MutationCtx, userId: string): Promise<void> {
  const rows = await ctx.db
    .query("channelMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
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

interface MemberView {
  readonly id: Id<"members">;
  readonly userId: string;
  readonly nickname: string | null;
  readonly roleIds: string[];
  readonly joinedAt: number;
  readonly timeoutUntil: number | null;
}

function toMemberView(member: Doc<"members">): MemberView {
  return {
    id: member._id,
    userId: member.userId,
    nickname: member.nickname ?? null,
    roleIds: member.roleIds,
    joinedAt: member.joinedAt,
    timeoutUntil: member.timeoutUntil ?? null,
  };
}

/** Every member with their roles and moderation state. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const members = await ctx.db.query("members").collect();
    return members.sort((a, b) => a.joinedAt - b.joinedAt).map(toMemberView);
  },
});

/**
 * The caller's own membership plus the workspace owner id. Used by clients to
 * gate admin UI and to protect the owner from moderation controls.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const server = await ctx.db.query("server").first();
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      userId,
      ownerId: server?.ownerId ?? null,
      isOwner: server !== null && server.ownerId === userId,
      member: member === null ? null : toMemberView(member),
    };
  },
});

/**
 * Assigns a role to a member. Requires `ManageRoles`, the role must be below
 * the actor's top role, the actor must hold every permission the role grants,
 * and the target must be below the actor in the hierarchy.
 */
export const assignRole = mutation({
  args: { userId: v.string(), roleId: v.id("roles") },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const member = await requireMember(ctx, args.userId);
    const role = await ctx.db.get(args.roleId);
    if (role === null) {
      throw new ConvexError("Role not found");
    }
    requireRoleManageable(context, role);
    requireCanGrant(context, role.permissions);
    await requireModerator(ctx, context, args.userId);

    const roleRef = role.key ?? role._id;
    if (member.roleIds.includes(roleRef)) {
      return mlsSignal([]);
    }
    await ctx.db.patch(member._id, { roleIds: [...member.roleIds, roleRef] });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.role.add",
      targetId: args.userId,
      meta: JSON.stringify({ roleId: roleRef }),
    });
    return mlsSignal([]);
  },
});

/**
 * Removes a role from a member. Losing a role can drop `ViewChannel` on a
 * channel, so any resulting MLS removals are returned for the client.
 */
export const removeRole = mutation({
  args: { userId: v.string(), roleId: v.id("roles") },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const member = await requireMember(ctx, args.userId);
    const role = await ctx.db.get(args.roleId);
    if (role === null) {
      throw new ConvexError("Role not found");
    }
    requireRoleManageable(context, role);
    await requireModerator(ctx, context, args.userId);

    const roleRef = role.key ?? role._id;
    if (!member.roleIds.includes(roleRef)) {
      return mlsSignal([]);
    }
    const nextRoleIds = member.roleIds.filter((roleId) => roleId !== roleRef);
    const removals = await memberDeltaRemovals(ctx, args.userId, member.roleIds, nextRoleIds);
    await ctx.db.patch(member._id, { roleIds: nextRoleIds });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.role.remove",
      targetId: args.userId,
      meta: JSON.stringify({ roleId: roleRef }),
    });
    return mlsSignal(removals);
  },
});

/** Sets a nickname for the caller (`ChangeOwnNickname`) or another member. */
export const setNickname = mutation({
  args: { userId: v.string(), nickname: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const isSelf = userId === args.userId;
    if (isSelf) {
      await requireWorkspaceContext(ctx, Permission.ChangeOwnNickname);
    } else {
      const { context } = await requireWorkspaceContext(ctx, Permission.ManageNicknames);
      await requireModerator(ctx, context, args.userId);
    }
    const member = await requireMember(ctx, args.userId);
    await ctx.db.patch(member._id, { nickname: args.nickname });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.nickname",
      targetId: args.userId,
    });
    return { ...toMemberView(member), nickname: args.nickname ?? null };
  },
});

/** Applies or clears a timeout on a member. Requires `Timeout` plus hierarchy. */
export const timeout = mutation({
  args: { userId: v.string(), until: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Timeout);
    await requireModerator(ctx, context, args.userId);
    const member = await requireMember(ctx, args.userId);
    await ctx.db.patch(member._id, { timeoutUntil: args.until });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.timeout",
      targetId: args.userId,
      meta: JSON.stringify({ until: args.until ?? null }),
    });
    return { ...toMemberView(member), timeoutUntil: args.until ?? null };
  },
});

/** Kicks a member: removes the member and their channel memberships. */
export const kick = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Kick);
    await requireModerator(ctx, context, args.userId);
    const member = await requireMember(ctx, args.userId);
    const removals = await memberDeltaRemovals(ctx, args.userId, member.roleIds, null);
    await detachFromChannels(ctx, args.userId);
    await ctx.db.delete(member._id);
    await writeAudit(ctx, { actorId: userId, action: "member.kick", targetId: args.userId });
    return mlsSignal(removals);
  },
});

/** Bans a member: writes a ban row and removes the member. */
export const ban = mutation({
  args: { userId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Ban);
    await requireModerator(ctx, context, args.userId);
    const member = await requireMember(ctx, args.userId);
    const removals = await memberDeltaRemovals(ctx, args.userId, member.roleIds, null);
    const existing = await ctx.db
      .query("bans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing === null) {
      await ctx.db.insert("bans", {
        userId: args.userId,
        actorId: userId,
        at: Date.now(),
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      });
    }
    await detachFromChannels(ctx, args.userId);
    await ctx.db.delete(member._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.ban",
      targetId: args.userId,
      ...(args.reason !== undefined ? { meta: JSON.stringify({ reason: args.reason }) } : {}),
    });
    return mlsSignal(removals);
  },
});

/** Lifts a ban. Hierarchy applies only when the target is still a member. */
export const unban = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Ban);
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (member !== null) {
      await requireModerator(ctx, context, args.userId);
    }
    const rows = await ctx.db
      .query("bans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    await writeAudit(ctx, { actorId: userId, action: "member.unban", targetId: args.userId });
    return { unbanned: rows.length > 0 };
  },
});

/** The ban list. Requires `Ban`. */
export const listBans = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspacePermission(ctx, Permission.Ban);
    const rows = await ctx.db.query("bans").collect();
    return rows
      .sort((a, b) => b.at - a.at)
      .map((row) => ({
        id: row._id,
        userId: row.userId,
        actorId: row.actorId,
        reason: row.reason ?? null,
        at: row.at,
      }));
  },
});
