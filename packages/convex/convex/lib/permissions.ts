import {
  ALL_PERMISSIONS,
  canGrantPermissions,
  canManageRole,
  canModerateMember,
  EVERYONE_ROLE_ID,
  hasPermission,
  highestRolePosition,
  isBotUserId,
  Permission,
  type Role,
  resolvePermissions,
} from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";
import { loadBotByUserId } from "./botAuth";

/** Synthetic role id a bot holds instead of `@everyone`. */
export const BOT_ROLE_ID = "@bot";

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
  /**
   * Present only for a bot actor: its workspace-level `grants` and optional
   * channel scope. Channel resolution clamps a bot to `grants`; people never
   * carry this field. See {@link channelPermissions}.
   */
  readonly bot?: BotPermissionInfo;
}

/** The bot-specific slice of a {@link PermissionContext}. */
export interface BotPermissionInfo {
  readonly id: Id<"bots">;
  readonly grants: bigint;
  /** `null` means every channel the grants reach. */
  readonly allowedChannelIds: readonly Id<"channels">[] | null;
}

async function memberRow(ctx: ReadCtx, userId: string): Promise<MemberDoc | null> {
  return await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Membership gate for the whole authorization layer. An authenticated identity
 * is not a member until it has a `members` row (created by invite redemption or
 * the IdP role attach). The workspace owner is treated as a member even
 * without a stored row so owner/setup flows are never locked out; an empty
 * `@everyone` baseline must never make a non-member look privileged.
 */
/**
 * Membership alone opens a handful of workspace-wide reads (member list, roles,
 * categories). A person gets those for free; a bot only with the workspace-level
 * `ViewChannel` grant, so a bot with no permissions really can do nothing.
 */
async function requireBotMayBrowse(ctx: ReadCtx, userId: string): Promise<void> {
  if (!isBotUserId(userId)) {
    return;
  }
  const bot = await loadBotByUserId(ctx, userId);
  if (bot === null || !bot.enabled || !hasPermission(bot.grants, Permission.ViewChannel)) {
    throw new ConvexError("Missing permission");
  }
}

export async function requireMember(ctx: ReadCtx, userId: string): Promise<void> {
  if ((await memberRow(ctx, userId)) !== null) {
    await requireBotMayBrowse(ctx, userId);
    return;
  }
  const server = await ctx.db.query("server").first();
  if (server !== null && server.ownerId === userId) {
    return;
  }
  throw new ConvexError("Not a member of this workspace");
}

export async function loadPermissionContext(
  ctx: ReadCtx,
  userId: string,
): Promise<PermissionContext> {
  // A bot is recognised by its `bot_` user id plus a `bots` row. It does not
  // inherit `@everyone`: it holds one synthetic role carrying exactly its
  // `grants`. A disabled bot is rejected outright so a not-yet-expired JWT
  // cannot act after an admin turns it off.
  if (isBotUserId(userId)) {
    const bot = await loadBotByUserId(ctx, userId);
    if (bot !== null) {
      if (!bot.enabled) {
        throw new ConvexError("Bot is disabled");
      }
      return {
        userId,
        isOwner: false,
        roleIds: [BOT_ROLE_ID],
        roles: [{ id: BOT_ROLE_ID, position: 0, permissions: bot.grants, isEveryone: false }],
        bot: {
          id: bot._id,
          grants: bot.grants,
          allowedChannelIds: bot.allowedChannelIds ?? null,
        },
      };
    }
  }
  const server = await ctx.db.query("server").first();
  const isOwner = server !== null && server.ownerId === userId;
  const member = await memberRow(ctx, userId);
  // Fail closed: without a member row (or owner status) the actor holds no
  // roles, so resolving `@everyone` would otherwise grant a non-member access.
  if (member === null && !isOwner) {
    throw new ConvexError("Not a member of this workspace");
  }
  const roleDocs = await ctx.db.query("roles").collect();
  return {
    userId,
    isOwner,
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

/** Clamps a bot actor to its grants; a person's permissions pass through. */
function clampBotGrants(context: PermissionContext, permissions: bigint): bigint {
  const bot = context.bot;
  return bot === undefined ? permissions : permissions & bot.grants;
}

export function channelPermissions(
  context: PermissionContext,
  channel: ChannelDoc,
  categoryOverrides: Doc<"categories">["overrides"],
): bigint {
  const resolved = resolvePermissions({
    actor: {
      userId: context.userId,
      roleIds: context.roleIds,
      isOwner: context.isOwner,
    },
    roles: context.roles,
    categoryOverrides,
    channelOverrides: channel.overrides,
  });
  const bot = context.bot;
  // A bot is clamped to its grants (channel overrides can only narrow them),
  // and to nothing at all when the admin scoped it to other channels.
  if (bot !== undefined && bot.allowedChannelIds !== null) {
    if (!bot.allowedChannelIds.includes(channel._id)) {
      return 0n;
    }
  }
  return clampBotGrants(context, resolved);
}

/**
 * The permissions an actor holds at the workspace level (no channel or
 * category overrides). This is the ceiling for anything they can grant.
 */
export function workspacePermissions(context: PermissionContext): bigint {
  return clampBotGrants(
    context,
    resolvePermissions({
      actor: {
        userId: context.userId,
        roleIds: context.roleIds,
        isOwner: context.isOwner,
      },
      roles: context.roles,
    }),
  );
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
  const permissions = clampBotGrants(
    context,
    resolvePermissions({
      actor: {
        userId: context.userId,
        roleIds: context.roleIds,
        isOwner: context.isOwner,
      },
      roles: context.roles,
      categoryOverrides,
    }),
  );
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
  return await requirePermissionForUser(ctx, userId, channelId, flag);
}

/**
 * {@link requirePermission} for an explicit actor, used where the identity is
 * not the Convex session (for example a signed download token re-validated in
 * an internal function). Fails closed for a non-member via
 * {@link loadPermissionContext}.
 */
export async function requirePermissionForUser(
  ctx: ReadCtx,
  userId: string,
  channelId: Id<"channels">,
  flag: bigint,
): Promise<ChannelPermissionResult> {
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

/** True when `roleId` refers to the workspace `@everyone` role. */
export function isEveryoneRole(role: RoleDoc): boolean {
  return role.key === EVERYONE_ROLE_ID;
}
