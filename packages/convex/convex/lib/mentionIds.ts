import { EVERYONE_ROLE_ID, hasPermission, isBotUserId, Permission } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { categoryChannels } from "./categoryChannels";
import {
  findChannelMember,
  isDmKind,
  type requireChannelAccess,
  requireChannelAccessForUser,
} from "./channels";
import { mapInChunks } from "./concurrency";
import { ownerIdsOf } from "./owners";
import { categoryOverridesFor, channelPermissions, toCoreRole } from "./permissions";

/**
 * Drops mention ids that do not resolve: a stored mention must point at a real
 * member, channel or category, so a client can never route a notification wake
 * to an arbitrary string. Unknown ids are filtered rather than stored.
 */
export async function filterMentionIds(
  ctx: Parameters<typeof requireChannelAccess>[0],
  mentionUserIds: readonly string[],
  mentionChannelIds: readonly string[],
  mentionCategoryIds: readonly string[],
  senderId: string,
): Promise<{
  mentionUserIds: string[];
  mentionChannelIds: string[];
  mentionCategoryIds: string[];
}> {
  const ids = [...new Set(mentionUserIds)];
  // Bound concurrent indexed reads without capping the mention list.
  const resolved = await mapInChunks(ids, 200, async (userId) => {
    const row = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return row === null ? null : userId;
  });
  const users = resolved.filter((userId): userId is string => userId !== null);
  const channels: string[] = [];
  for (const channelId of new Set(mentionChannelIds)) {
    try {
      if ((await ctx.db.get(channelId as Id<"channels">)) !== null) {
        await requireChannelAccessForUser(
          ctx,
          senderId,
          channelId as Id<"channels">,
          Permission.ViewChannel,
        );
        channels.push(channelId);
      }
    } catch {
      // A malformed id is not a known channel; drop it.
    }
  }
  const categories: string[] = [];
  for (const categoryId of new Set(mentionCategoryIds)) {
    try {
      if ((await ctx.db.get(categoryId as Id<"categories">)) !== null) {
        for (const channel of await categoryChannels(ctx, categoryId as Id<"categories">))
          await requireChannelAccessForUser(ctx, senderId, channel._id, Permission.ViewChannel);
        categories.push(categoryId);
      }
    } catch {
      // A malformed id is not a known category; drop it.
    }
  }
  return {
    mentionUserIds: users,
    mentionChannelIds: channels,
    mentionCategoryIds: categories,
  };
}

/**
 * `@role` mentions are expanded here (once per send) instead of on every
 * client, which no longer holds the whole member table. Direct mentions and legacy broadcasts
 * still arrive as user ids; capable clients send broadcast markers. The reverse `memberRoles`
 * index is trusted only after backfill completes. Both paths page to completion;
 * mention lists intentionally have no count cap.
 */
export async function mentionUserIdsForRoles(
  ctx: Parameters<typeof requireChannelAccess>[0],
  roleIds: readonly string[],
  channelId?: Id<"channels">,
): Promise<string[]> {
  const requested = new Set(roleIds);
  if (requested.size === 0) {
    return [];
  }
  // Only mentionable roles expand, matching the client's own resolution: a
  // role an admin silenced must not be pingable by calling the API directly.
  const roles = await ctx.db.query("roles").collect();
  const mentionable = new Set(
    roles
      .filter((role) => role.mentionable && (role.key ?? role._id) !== EVERYONE_ROLE_ID)
      .map((role) => role.key ?? role._id),
  );
  const selected = new Set([...requested].filter((id) => mentionable.has(id)));
  if (selected.size === 0) return [];
  const userIds = new Set<string>();
  const server = await ctx.db.query("server").first();
  if (server?.memberRolesBackfilled === true) {
    for (const roleId of selected) {
      let cursor: string | null = null;
      while (true) {
        const result = await ctx.db
          .query("memberRoles")
          .withIndex("by_role", (q) => q.eq("roleId", roleId))
          .paginate({ numItems: 200, cursor });
        for (const link of result.page) userIds.add(link.userId);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
    }
  } else {
    // A partially populated reverse index must never hide legacy members.
    // Scan once for all requested roles, including roles with zero links.
    let cursor: string | null = null;
    while (true) {
      const result = await ctx.db
        .query("members")
        .withIndex("by_joined")
        .paginate({ numItems: 200, cursor });
      for (const member of result.page) {
        if (member.roleIds.some((id) => selected.has(id))) userIds.add(member.userId);
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
  }
  if (channelId === undefined) return [...userIds];
  const channel = await ctx.db.get(channelId);
  if (channel === null) return [];
  const categoryOverrides = await categoryOverridesFor(ctx, channel);
  const coreRoles = roles.map(toCoreRole);
  const owners = new Set(ownerIdsOf(server));
  // Share configuration reads; only candidate memberships need indexed lookups.
  const visible = await mapInChunks([...userIds], 50, async (userId) => {
    try {
      if (isBotUserId(userId)) {
        await requireChannelAccessForUser(ctx, userId, channelId, Permission.ViewChannel);
        return userId;
      }
      const member = await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (member === null && !owners.has(userId)) return null;
      const permissions = channelPermissions(
        {
          userId,
          isOwner: owners.has(userId),
          roleIds: member?.roleIds ?? [],
          roles: coreRoles,
        },
        channel,
        categoryOverrides,
      );
      if (!hasPermission(permissions, Permission.ViewChannel)) return null;
      if (
        (isDmKind(channel.kind) || channel.private === true) &&
        !(await findChannelMember(ctx, channelId, userId))
      )
        return null;
      return userId;
    } catch (error) {
      if (error instanceof ConvexError) return null;
      throw error;
    }
  });
  return visible.filter((userId): userId is string => userId !== null);
}
