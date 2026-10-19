import type { MutationCtx } from "../_generated/server";

/** Member↔role links detached per mutation run before rescheduling. */
export const MEMBER_ROLE_DETACH_BATCH = 200;

async function findLink(ctx: MutationCtx, userId: string, roleId: string) {
  return await ctx.db
    .query("memberRoles")
    .withIndex("by_user_role", (q) => q.eq("userId", userId).eq("roleId", roleId))
    .unique();
}

/** Adds a single member↔role link if it is not already present. */
export async function addMemberRoleLink(
  ctx: MutationCtx,
  userId: string,
  roleId: string,
  joinedAt: number = Date.now(),
): Promise<void> {
  const existing = await findLink(ctx, userId, roleId);
  if (existing === null) {
    await ctx.db.insert("memberRoles", { userId, roleId, joinedAt });
  }
}

/** Removes a single member↔role link if present. */
export async function removeMemberRoleLink(
  ctx: MutationCtx,
  userId: string,
  roleId: string,
): Promise<void> {
  const existing = await findLink(ctx, userId, roleId);
  if (existing !== null) {
    await ctx.db.delete(existing._id);
  }
}

/** Rewrites a member's links so they exactly match `roleIds` (idempotent). */
export async function syncMemberRoles(
  ctx: MutationCtx,
  userId: string,
  roleIds: readonly string[],
  joinedAt: number,
): Promise<void> {
  const wanted = new Set(roleIds);
  const links = await ctx.db
    .query("memberRoles")
    .withIndex("by_user_role", (q) => q.eq("userId", userId))
    .collect();
  const present = new Set<string>();
  for (const link of links) {
    if (wanted.has(link.roleId)) {
      present.add(link.roleId);
    } else {
      await ctx.db.delete(link._id);
    }
  }
  for (const roleId of wanted) {
    if (!present.has(roleId)) {
      await ctx.db.insert("memberRoles", { userId, roleId, joinedAt });
    }
  }
}

/** Removes every link for a user (kick/ban/bot teardown). */
export async function deleteMemberRolesForUser(ctx: MutationCtx, userId: string): Promise<void> {
  const links = await ctx.db
    .query("memberRoles")
    .withIndex("by_user_role", (q) => q.eq("userId", userId))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
}

/** True once the reverse table has been fully backfilled. */
export async function hasMemberRoleLinks(ctx: MutationCtx): Promise<boolean> {
  const server = await ctx.db.query("server").first();
  return server?.memberRolesBackfilled === true;
}

/**
 * Detaches `roleId` from one bounded batch of members using the reverse index,
 * patching `members.roleIds` and deleting the link rows. Returns `true` when a
 * full batch was processed, i.e. more members may still hold the role.
 */
export async function detachRoleBatch(ctx: MutationCtx, roleId: string): Promise<boolean> {
  const links = await ctx.db
    .query("memberRoles")
    .withIndex("by_role", (q) => q.eq("roleId", roleId))
    .take(MEMBER_ROLE_DETACH_BATCH);
  for (const link of links) {
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", link.userId))
      .unique();
    if (member?.roleIds.includes(roleId)) {
      await ctx.db.patch(member._id, {
        roleIds: member.roleIds.filter((id) => id !== roleId),
      });
    }
    await ctx.db.delete(link._id);
  }
  return links.length === MEMBER_ROLE_DETACH_BATCH;
}
