import { hasPermission, type Role, resolvePermissions } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";

export type ServerDoc = Doc<"server">;
export type MemberDoc = Doc<"members">;
export type RoleDoc = Doc<"roles">;
export type ChannelDoc = Doc<"channels">;
export type CategoryDoc = Doc<"categories">;

type ReadCtx = QueryCtx | MutationCtx;

/** Maps a stored role document onto the shared `@aulora/core` role shape. */
export function toCoreRole(role: RoleDoc): Role {
  return {
    id: role.key ?? role._id,
    position: role.position,
    permissions: role.permissions,
  };
}

export interface PermissionContext {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly roleIds: readonly string[];
  readonly roles: readonly Role[];
}

export async function loadPermissionContext(
  ctx: ReadCtx,
  userId: string,
): Promise<PermissionContext> {
  const server = await ctx.db.query("server").first();
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const roleDocs = await ctx.db.query("roles").collect();
  return {
    userId,
    isOwner: server !== null && server.ownerId === userId,
    roleIds: member?.roleIds ?? [],
    roles: roleDocs.map(toCoreRole),
  };
}

export async function categoryOverridesFor(
  ctx: ReadCtx,
  channel: ChannelDoc,
): Promise<Doc<"categories">["overrides"]> {
  if (channel.categoryId === undefined) {
    return [];
  }
  const category = await ctx.db.get(channel.categoryId);
  return category?.overrides ?? [];
}

export function channelPermissions(
  context: PermissionContext,
  channel: ChannelDoc,
  categoryOverrides: Doc<"categories">["overrides"],
): bigint {
  return resolvePermissions({
    actor: {
      userId: context.userId,
      roleIds: context.roleIds,
      isOwner: context.isOwner,
    },
    roles: context.roles,
    categoryOverrides,
    channelOverrides: channel.overrides,
  });
}

export interface WorkspacePermissionResult {
  readonly userId: string;
  readonly permissions: bigint;
}

/**
 * Gate for actions that are not scoped to an existing channel yet (creating a
 * channel, generating an upload URL). Category overrides are applied when a
 * target category is supplied.
 */
export async function requireWorkspacePermission(
  ctx: ReadCtx,
  flag: bigint,
  categoryId?: Id<"categories">,
): Promise<WorkspacePermissionResult> {
  const { userId } = await requireAuth(ctx);
  const context = await loadPermissionContext(ctx, userId);
  let categoryOverrides: Doc<"categories">["overrides"] = [];
  if (categoryId !== undefined) {
    const category = await ctx.db.get(categoryId);
    categoryOverrides = category?.overrides ?? [];
  }
  const permissions = resolvePermissions({
    actor: {
      userId: context.userId,
      roleIds: context.roleIds,
      isOwner: context.isOwner,
    },
    roles: context.roles,
    categoryOverrides,
  });
  if (!hasPermission(permissions, flag)) {
    throw new ConvexError("Missing permission");
  }
  return { userId, permissions };
}

export interface ChannelPermissionResult {
  readonly userId: string;
  readonly channel: ChannelDoc;
  readonly permissions: bigint;
}

/**
 * The single server-side gate every mutation should call:
 * `requirePermission(ctx, channelId, Permission.SendMessages)`.
 */
export async function requirePermission(
  ctx: ReadCtx,
  channelId: Id<"channels">,
  flag: bigint,
): Promise<ChannelPermissionResult> {
  const { userId } = await requireAuth(ctx);
  const channel = await ctx.db.get(channelId);
  if (channel === null) {
    throw new ConvexError("Channel not found");
  }
  const context = await loadPermissionContext(ctx, userId);
  const categoryOverrides = await categoryOverridesFor(ctx, channel);
  const permissions = channelPermissions(context, channel, categoryOverrides);
  if (!hasPermission(permissions, flag)) {
    throw new ConvexError("Missing permission");
  }
  return { userId, channel, permissions };
}
