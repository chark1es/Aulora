import {
  ALL_PERMISSIONS,
  canGrantPermissions,
  canManageRole,
  canModerateMember,
  EVERYONE_ROLE_ID,
  hasPermission,
  highestRolePosition,
  type Overwrite,
  Permission,
  type Role,
  resolvePermissions,
} from "@aulora/core";
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
  const id = role.key ?? role._id;
  return {
    id,
    position: role.position,
    permissions: role.permissions,
    isEveryone: id === EVERYONE_ROLE_ID,
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

/**
 * The permissions an actor holds at the workspace level (no channel or
 * category overrides). This is the ceiling for anything they can grant.
 */
export function workspacePermissions(context: PermissionContext): bigint {
  return resolvePermissions({
    actor: {
      userId: context.userId,
      roleIds: context.roleIds,
      isOwner: context.isOwner,
    },
    roles: context.roles,
  });
}

/** The position of the actor's highest role; owners sit above every role. */
export function actorTopPosition(context: PermissionContext): number {
  if (context.isOwner) {
    return Number.POSITIVE_INFINITY;
  }
  return highestRolePosition(context.roleIds, context.roles);
}

/** Throws unless the actor may edit, assign or delete `role`. */
export function requireRoleManageable(context: PermissionContext, role: RoleDoc): void {
  const manageable = canManageRole(
    {
      userId: context.userId,
      topRolePosition: actorTopPosition(context),
      isOwner: context.isOwner,
    },
    role.position,
  );
  if (!manageable) {
    throw new ConvexError("Role is not below your highest role");
  }
}

/** Throws unless the actor holds every bit in `requested`. */
export function requireCanGrant(context: PermissionContext, requested: bigint): void {
  if (!canGrantPermissions(workspacePermissions(context), requested)) {
    throw new ConvexError("Cannot grant a permission you do not hold");
  }
}

/** Rejects any permission bit outside the defined set. */
export function assertValidPermissionBits(value: bigint): void {
  if (value < 0n || (value & ~ALL_PERMISSIONS) !== 0n) {
    throw new ConvexError("Invalid permission bits");
  }
}

/** Throws unless the actor's top role is strictly above the target member's. */
export async function requireModerator(
  ctx: ReadCtx,
  context: PermissionContext,
  targetUserId: string,
): Promise<void> {
  const server = await ctx.db.query("server").first();
  const target = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", targetUserId))
    .unique();
  const allowed = canModerateMember({
    actor: {
      userId: context.userId,
      roleIds: context.roleIds,
      isOwner: context.isOwner,
    },
    target: {
      userId: targetUserId,
      roleIds: target?.roleIds ?? [],
      isOwner: server !== null && server.ownerId === targetUserId,
    },
    roles: context.roles,
  });
  if (!allowed) {
    throw new ConvexError("Target is not below your highest role");
  }
}

export interface WorkspacePermissionResult {
  readonly userId: string;
  readonly context: PermissionContext;
  readonly permissions: bigint;
}

/** Loads the actor context and resolved permissions, requiring `flag` when given. */
export async function requireWorkspaceContext(
  ctx: ReadCtx,
  flag?: bigint,
  categoryId?: Id<"categories">,
): Promise<WorkspacePermissionResult> {
  const { userId } = await requireAuth(ctx);
  const context = await loadPermissionContext(ctx, userId);
  let categoryOverrides: Doc<"categories">["overrides"] = [];
  if (categoryId !== undefined) {
    const category = await ctx.db.get(categoryId);
    if (category === null) {
      throw new ConvexError("Category not found");
    }
    categoryOverrides = category.overrides;
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
  if (flag !== undefined && !hasPermission(permissions, flag)) {
    throw new ConvexError("Missing permission");
  }
  return { userId, context, permissions };
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
): Promise<{ userId: string; permissions: bigint }> {
  const { userId, permissions } = await requireWorkspaceContext(ctx, flag, categoryId);
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

/** A channel/user pair that needs an MLS Remove commit on the client. */
export interface MlsRemoval {
  readonly channelId: Id<"channels">;
  readonly userId: string;
}

export interface MlsSignal {
  readonly mlsAction: "remove" | null;
  readonly mlsRemovals: MlsRemoval[];
}

/** Normalizes a set of removals into the signal the client acts on. */
export function mlsSignal(removals: readonly MlsRemoval[]): MlsSignal {
  return {
    mlsAction: removals.length > 0 ? "remove" : null,
    mlsRemovals: [...removals],
  };
}

/**
 * Everything needed to decide who can view a channel. Point-in-time snapshots
 * are compared before and after a permission change to find members who lost
 * `ViewChannel` and therefore need an MLS Remove commit.
 */
export interface ViewerInputs {
  readonly ownerId: string | null;
  readonly roles: readonly Role[];
  readonly members: readonly { readonly userId: string; readonly roleIds: readonly string[] }[];
  readonly categoryOverrides: ReadonlyMap<string, readonly Overwrite[]>;
  /** When set, replaces the stored overrides for channels in the map. */
  readonly channelOverrides?: ReadonlyMap<string, readonly Overwrite[]>;
}

export async function loadViewerInputs(ctx: ReadCtx): Promise<ViewerInputs> {
  const server = await ctx.db.query("server").first();
  const roleDocs = await ctx.db.query("roles").collect();
  const memberDocs = await ctx.db.query("members").collect();
  const categories = await ctx.db.query("categories").collect();
  const categoryOverrides = new Map<string, readonly Overwrite[]>();
  for (const category of categories) {
    categoryOverrides.set(category._id, category.overrides);
  }
  return {
    ownerId: server?.ownerId ?? null,
    roles: roleDocs.map(toCoreRole),
    members: memberDocs.map((member) => ({
      userId: member.userId,
      roleIds: member.roleIds,
    })),
    categoryOverrides,
  };
}

export function viewersForChannel(channel: ChannelDoc, inputs: ViewerInputs): ReadonlySet<string> {
  const categoryOverrides =
    channel.categoryId !== undefined
      ? (inputs.categoryOverrides.get(channel.categoryId) ?? [])
      : [];
  const channelOverrides = inputs.channelOverrides?.get(channel._id) ?? channel.overrides;
  const viewers = new Set<string>();
  for (const member of inputs.members) {
    const permissions = resolvePermissions({
      actor: {
        userId: member.userId,
        roleIds: member.roleIds,
        isOwner: member.userId === inputs.ownerId,
      },
      roles: inputs.roles,
      categoryOverrides,
      channelOverrides,
    });
    if (hasPermission(permissions, Permission.ViewChannel)) {
      viewers.add(member.userId);
    }
  }
  if (inputs.ownerId !== null) {
    viewers.add(inputs.ownerId);
  }
  return viewers;
}

function isDmChannel(channel: ChannelDoc): boolean {
  return channel.kind === "dm" || channel.kind === "group_dm";
}

/**
 * Diffs the viewer snapshots of every non-DM channel and returns the members
 * who lost `ViewChannel`. DMs are excluded because their access is proven by
 * `channelMembers`, not by role permissions.
 */
export async function removalsBetween(
  ctx: ReadCtx,
  before: ViewerInputs,
  after: ViewerInputs,
): Promise<MlsRemoval[]> {
  const channels = await ctx.db.query("channels").collect();
  const removals: MlsRemoval[] = [];
  for (const channel of channels) {
    if (isDmChannel(channel)) {
      continue;
    }
    const beforeViewers = viewersForChannel(channel, before);
    const afterViewers = viewersForChannel(channel, after);
    for (const userId of beforeViewers) {
      if (!afterViewers.has(userId)) {
        removals.push({ channelId: channel._id, userId });
      }
    }
  }
  return removals;
}

/** Removals caused by changing a member's roles (or removing the member). */
export async function memberDeltaRemovals(
  ctx: ReadCtx,
  userId: string,
  beforeRoleIds: readonly string[],
  afterRoleIds: readonly string[] | null,
): Promise<MlsRemoval[]> {
  const base = await loadViewerInputs(ctx);
  const before: ViewerInputs = {
    ...base,
    members: base.members.map((member) =>
      member.userId === userId ? { ...member, roleIds: beforeRoleIds } : member,
    ),
  };
  const afterMembers =
    afterRoleIds === null
      ? base.members.filter((member) => member.userId !== userId)
      : base.members.map((member) =>
          member.userId === userId ? { ...member, roleIds: afterRoleIds } : member,
        );
  const after: ViewerInputs = { ...base, members: afterMembers };
  return await removalsBetween(ctx, before, after);
}

/** Removals caused by changing a role's permissions. */
export async function roleChangeRemovals(
  ctx: ReadCtx,
  roleId: Id<"roles">,
  previousPermissions: bigint,
  nextPermissions: bigint | null,
): Promise<MlsRemoval[]> {
  if (previousPermissions === nextPermissions) {
    return [];
  }
  const base = await loadViewerInputs(ctx);
  const before: ViewerInputs = { ...base, roles: base.roles.map((role) => ({ ...role })) };
  const afterRoles = base.roles.map((role) => {
    if (role.id !== roleId) {
      return role;
    }
    return nextPermissions === null
      ? { ...role, permissions: 0n }
      : { ...role, permissions: nextPermissions };
  });
  const after: ViewerInputs = { ...base, roles: afterRoles };
  return await removalsBetween(ctx, before, after);
}

/** Removals caused by changing a single channel's overrides. */
export async function channelOverrideRemovals(
  ctx: ReadCtx,
  channel: ChannelDoc,
  nextOverrides: readonly Overwrite[],
): Promise<MlsRemoval[]> {
  const base = await loadViewerInputs(ctx);
  const before: ViewerInputs = {
    ...base,
    channelOverrides: new Map([[channel._id, channel.overrides]]),
  };
  const after: ViewerInputs = {
    ...base,
    channelOverrides: new Map([[channel._id, nextOverrides]]),
  };
  return await removalsBetween(ctx, before, after);
}

/** Removals caused by changing a category's overrides. */
export async function categoryOverrideRemovals(
  ctx: ReadCtx,
  categoryId: Id<"categories">,
  nextOverrides: readonly Overwrite[],
): Promise<MlsRemoval[]> {
  const base = await loadViewerInputs(ctx);
  const previous = base.categoryOverrides.get(categoryId) ?? [];
  const beforeMap = new Map(base.categoryOverrides);
  beforeMap.set(categoryId, previous);
  const afterMap = new Map(base.categoryOverrides);
  afterMap.set(categoryId, nextOverrides);
  const before: ViewerInputs = { ...base, categoryOverrides: beforeMap };
  const after: ViewerInputs = { ...base, categoryOverrides: afterMap };
  return await removalsBetween(ctx, before, after);
}

/** True when `roleId` refers to the workspace `@everyone` role. */
export function isEveryoneRole(role: RoleDoc): boolean {
  return role.key === EVERYONE_ROLE_ID;
}
