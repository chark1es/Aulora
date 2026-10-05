import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { pruneExpiredBans } from "./lib/bans";
import {
  requireCanGrant,
  requireMember,
  requireModerator,
  requireRoleManageable,
  requireWorkspaceContext,
  requireWorkspacePermission,
} from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { openContentOptional } from "./lib/sealed";
import { sealString } from "./lib/sse";
import type { Nullable } from "./lib/types";

type ReadCtx = Parameters<typeof requireAuth>[0];

const BIO_CONTEXT = { scope: "member.bio" } as const;
const MAX_BIO_LENGTH = 500;
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

function isAvatarImage(metadata: {
  readonly size: number;
  readonly contentType?: string | null;
}): boolean {
  if (metadata.size <= 0 || metadata.size > MAX_AVATAR_BYTES) {
    return false;
  }
  const contentType = (metadata.contentType ?? "").toLowerCase();
  return contentType.length === 0 || contentType.startsWith("image/");
}

/** A workspace member's public summary. */
export const profile = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (member === null) {
      return null;
    }
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return {
      userId: member.userId,
      bio: await openContentOptional(BIO_CONTEXT, member.bioCiphertext),
      avatarUrl:
        member.avatarStorageId !== undefined
          ? await ctx.storage.getUrl(member.avatarStorageId)
          : null,
      lastOnlineAt:
        presence?.lastOnlineAt ??
        (presence !== null && !(presence.manual === true && presence.status === "offline")
          ? presence.lastHeartbeat
          : null),
    };
  },
});

/** Edits only the caller's bio, sealed at rest. An empty value clears it. */
export const setBio = mutation({
  args: { bio: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const bio = args.bio.trim();
    if (bio.length > MAX_BIO_LENGTH) {
      throw new ConvexError(`Bio must be ${MAX_BIO_LENGTH} characters or fewer`);
    }
    const member = await requireMemberRow(ctx, userId);
    await ctx.db.patch(member._id, {
      bioCiphertext: bio.length > 0 ? await sealString(BIO_CONTEXT, bio) : undefined,
    });
    return null;
  },
});

/** Upload URL for the caller's workspace profile picture. Membership is enough. */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("avatar", userId),
      limit: 10,
      windowMs: 60_000,
    });
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Sets or clears the caller's profile picture in this workspace. Other
 * workspaces keep their own picture because each server has its own member row.
 */
export const setAvatar = mutation({
  args: { storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const member = await requireMemberRow(ctx, userId);
    const previous = member.avatarStorageId;
    if (args.storageId !== undefined) {
      const url = await ctx.storage.getUrl(args.storageId);
      if (url === null) {
        throw new ConvexError("Avatar file not found");
      }
      const metadata = await ctx.db.system.get("_storage", args.storageId);
      if (metadata === null || !isAvatarImage(metadata)) {
        throw new ConvexError("Avatar must be an image under 4 MB");
      }
      await ctx.db.patch(member._id, { avatarStorageId: args.storageId });
    } else {
      await ctx.db.patch(member._id, { avatarStorageId: undefined });
    }
    if (previous !== undefined && previous !== args.storageId) {
      await ctx.storage.delete(previous);
    }
    return null;
  },
});

async function findRoleByName(ctx: MutationCtx, name: string): Promise<Nullable<Doc<"roles">>> {
  const roles = await ctx.db.query("roles").collect();
  const match = roles.find((role) => role.name === name || role.key === name);
  return match ?? null;
}

async function requireMemberRow(ctx: ReadCtx, userId: string): Promise<Doc<"members">> {
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
    // A banned account never re-joins through the auth hook, even when the
    // workspace is not invite-only; an expired temp ban is pruned here.
    if (await pruneExpiredBans(ctx, args.userId)) {
      return null;
    }
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
  /** The account's own name (or email local part); `null` if unavailable. */
  readonly accountName: string | null;
  readonly roleIds: string[];
  readonly joinedAt: number;
  readonly timeoutUntil: number | null;
  /** This workspace's profile picture, or null for the generated avatar. */
  readonly avatarUrl: string | null;
}

async function toMemberView(
  ctx: ReadCtx,
  member: Doc<"members">,
  accountName: string | null = null,
): Promise<MemberView> {
  return {
    id: member._id,
    userId: member.userId,
    nickname: member.nickname ?? null,
    accountName,
    roleIds: member.roleIds,
    joinedAt: member.joinedAt,
    timeoutUntil: member.timeoutUntil ?? null,
    avatarUrl:
      member.avatarStorageId !== undefined
        ? await ctx.storage.getUrl(member.avatarStorageId)
        : null,
  };
}

/** Every member with their roles and moderation state. Members only. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const members = await ctx.db.query("members").collect();
    const names = await accountNames(
      ctx,
      members.map((member) => member.userId),
    );
    return await Promise.all(
      members
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((member) => toMemberView(ctx, member, names.get(member.userId) ?? null)),
    );
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
      member:
        member === null
          ? null
          : await toMemberView(
              ctx,
              member,
              (await accountNames(ctx, [userId])).get(userId) ?? null,
            ),
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
    const member = await requireMemberRow(ctx, args.userId);
    const role = await ctx.db.get(args.roleId);
    if (role === null) {
      throw new ConvexError("Role not found");
    }
    requireRoleManageable(context, role);
    requireCanGrant(context, role.permissions);
    await requireModerator(ctx, context, args.userId);

    const roleRef = role.key ?? role._id;
    if (member.roleIds.includes(roleRef)) {
      return null;
    }
    await ctx.db.patch(member._id, { roleIds: [...member.roleIds, roleRef] });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.role.add",
      targetId: args.userId,
      meta: JSON.stringify({ roleId: roleRef }),
    });
    return null;
  },
});

/**
 * Removes a role from a member. Losing a role can drop `ViewChannel` on a
 * channel, so future per-content access decisions must honour the new role set.
 */
export const removeRole = mutation({
  args: { userId: v.string(), roleId: v.id("roles") },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageRoles);
    const member = await requireMemberRow(ctx, args.userId);
    const role = await ctx.db.get(args.roleId);
    if (role === null) {
      throw new ConvexError("Role not found");
    }
    requireRoleManageable(context, role);
    await requireModerator(ctx, context, args.userId);

    const roleRef = role.key ?? role._id;
    if (!member.roleIds.includes(roleRef)) {
      return null;
    }
    const nextRoleIds = member.roleIds.filter((roleId) => roleId !== roleRef);
    await ctx.db.patch(member._id, { roleIds: nextRoleIds });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.role.remove",
      targetId: args.userId,
      meta: JSON.stringify({ roleId: roleRef }),
    });
    return null;
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
    const member = await requireMemberRow(ctx, args.userId);
    await ctx.db.patch(member._id, { nickname: args.nickname });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.nickname",
      targetId: args.userId,
    });
    return { ...(await toMemberView(ctx, member)), nickname: args.nickname ?? null };
  },
});

/** Applies or clears a timeout on a member. Requires `Timeout` plus hierarchy. */
export const timeout = mutation({
  args: { userId: v.string(), until: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Timeout);
    await requireModerator(ctx, context, args.userId);
    const member = await requireMemberRow(ctx, args.userId);
    await ctx.db.patch(member._id, { timeoutUntil: args.until });
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.timeout",
      targetId: args.userId,
      meta: JSON.stringify({ until: args.until ?? null }),
    });
    return { ...(await toMemberView(ctx, member)), timeoutUntil: args.until ?? null };
  },
});

/** Kicks a member: removes the member and their channel memberships. */
export const kick = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Kick);
    await requireModerator(ctx, context, args.userId);
    const member = await requireMemberRow(ctx, args.userId);
    await detachFromChannels(ctx, args.userId);
    await ctx.db.delete(member._id);
    await writeAudit(ctx, { actorId: userId, action: "member.kick", targetId: args.userId });
    return null;
  },
});

/**
 * Bans a member: writes a ban row and removes the member. `durationMs` makes
 * the ban temporary; absent it is permanent.
 */
export const ban = mutation({
  args: {
    userId: v.string(),
    reason: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.Ban);
    await requireModerator(ctx, context, args.userId);
    if (
      args.durationMs !== undefined &&
      (!Number.isFinite(args.durationMs) || args.durationMs <= 0)
    ) {
      throw new ConvexError("durationMs must be a positive number of milliseconds");
    }
    const member = await requireMemberRow(ctx, args.userId);
    const now = Date.now();
    const expiresAt = args.durationMs !== undefined ? now + args.durationMs : undefined;
    const existing = await ctx.db
      .query("bans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing === null) {
      await ctx.db.insert("bans", {
        userId: args.userId,
        actorId: userId,
        at: now,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
    } else {
      await ctx.db.patch(existing._id, {
        actorId: userId,
        at: now,
        reason: args.reason,
        expiresAt,
      });
    }
    await detachFromChannels(ctx, args.userId);
    await ctx.db.delete(member._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "member.ban",
      targetId: args.userId,
      meta: JSON.stringify({
        reason: args.reason ?? null,
        expiresAt: expiresAt ?? null,
      }),
    });
    return null;
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
        expiresAt: row.expiresAt ?? null,
      }));
  },
});
