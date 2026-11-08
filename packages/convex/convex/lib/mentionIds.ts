import { EVERYONE_ROLE_ID } from "@aulora/core";
import type { Id } from "../_generated/dataModel";
import type { requireChannelAccess } from "./channels";
import { memberIdsForRole } from "./memberRoles";

/**
 * Members one `@role` mention expands to on send. Roles are normally small;
 * the cap keeps a pathological role from turning one send into an unbounded
 * read, and the legacy fallback scan uses the same bound.
 */
const ROLE_MENTION_MEMBER_LIMIT = 500;

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
): Promise<{
  mentionUserIds: string[];
  mentionChannelIds: string[];
  mentionCategoryIds: string[];
}> {
  const ids = [...new Set(mentionUserIds)];
  // Resolve the mentioned ids in one parallel batch of indexed reads instead of
  // awaiting each one before starting the next.
  const resolved = await Promise.all(
    ids.map(async (userId) => {
      const row = await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      return row === null ? null : userId;
    }),
  );
  const users = resolved.filter((userId): userId is string => userId !== null);
  const channels: string[] = [];
  for (const channelId of new Set(mentionChannelIds)) {
    try {
      if ((await ctx.db.get(channelId as Id<"channels">)) !== null) {
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
 * client, which no longer holds the whole member table. Direct and broadcast
 * mentions still arrive as user ids from the client. The reverse `memberRoles`
 * index bounds the read; rows on a workspace that predates the backfill fall
 * back to a bounded scan of `members.roleIds`.
 */
export async function mentionUserIdsForRoles(
  ctx: Parameters<typeof requireChannelAccess>[0],
  roleIds: readonly string[],
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
  const userIds: string[] = [];
  for (const roleId of requested) {
    if (!mentionable.has(roleId)) {
      continue;
    }
    const linked = await memberIdsForRole(ctx, roleId, ROLE_MENTION_MEMBER_LIMIT);
    if (linked.length > 0) {
      userIds.push(...linked);
      continue;
    }
    const legacy = await ctx.db
      .query("members")
      .withIndex("by_joined")
      .take(ROLE_MENTION_MEMBER_LIMIT);
    for (const member of legacy) {
      if (member.roleIds.includes(roleId)) {
        userIds.push(member.userId);
      }
    }
  }
  return userIds;
}
