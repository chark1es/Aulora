import { v } from "convex/values";
import type { Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { adjustMemberCount } from "./lib/memberCount";
import { deleteMemberRolesForUser } from "./lib/memberRoles";

/**
 * Deletes every row in one collected batch. Small helper so the cleanup below
 * reads as a list of what a deleted account owns rather than delete boilerplate.
 */
async function deleteRows(
  ctx: MutationCtx,
  rows: Promise<Array<{ _id: Id<TableNames> }>>,
): Promise<void> {
  for (const row of await rows) {
    await ctx.db.delete(row._id);
  }
}

/** Deletes the member row, its avatar blob, and keeps the member count exact. */
async function deleteMember(ctx: MutationCtx, userId: string): Promise<void> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (member === null) {
    return;
  }
  if (member.avatarStorageId !== undefined) {
    await ctx.storage.delete(member.avatarStorageId);
  }
  await ctx.db.delete(member._id);
  await adjustMemberCount(ctx, -1);
}

/**
 * Removes the personal rows that belong to a deleted account.
 *
 * Better Auth deletes its own user/account/session rows, then calls this from
 * the `afterDelete` hook. Workspace content the person authored (messages,
 * notes, kanban items, uploaded files) stays with the workspace: it is shared
 * history, the same way `members.kick` leaves it behind. Everything keyed to
 * this user as *their* state — membership, devices, presence, read state,
 * notification preferences, call seats, delivery tokens — goes.
 *
 * Idempotent: a missing row is simply skipped, so a retried cleanup is safe.
 */
export const deleteUserData = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await deleteMember(ctx, userId);
    await deleteMemberRolesForUser(ctx, userId);

    await deleteRows(
      ctx,
      ctx.db
        .query("channelMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("readStates")
        .withIndex("by_user_channel", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("notificationPrefs")
        .withIndex("by_user_scope", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("threadParticipants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("devices")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("presence")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("callParticipants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("callSignals")
        .withIndex("by_to", (q) => q.eq("toUserId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("reactions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("kanbanGithub")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("joinCodes")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("bans")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );

    // Private notes the person wrote, and notes others wrote about them.
    await deleteRows(
      ctx,
      ctx.db
        .query("userNotes")
        .withIndex("by_author", (q) => q.eq("authorId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      ctx.db
        .query("userNotes")
        .withIndex("by_target", (q) => q.eq("targetUserId", userId))
        .collect(),
    );
  },
});
