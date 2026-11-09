import { ConvexError, v } from "convex/values";
import type { Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { adjustMemberCount } from "./lib/memberCount";
import { deleteMemberRolesForUser } from "./lib/memberRoles";
import { liveOwnerIdsAmong } from "./lib/ownerLiveness";
import { ownerIdsOf, withoutDeletionReservation } from "./lib/owners";

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
    // A departing owner stops being an owner. `beforeDelete` reserved that
    // transition atomically, so cleanup must fail closed if the reservation is
    // missing: silently deleting a member while leaving their id in `ownerIds`
    // would strand the workspace. The reservation is consumed in the same
    // transaction that removes the owner, so a failure leaves both untouched.
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      const ownerIds = ownerIdsOf(server);
      const reservations = server.ownerDeletionReservations ?? [];
      const hasReservation = reservations.some((row) => row.userId === userId);
      if (ownerIds.includes(userId)) {
        if (!hasReservation) {
          throw new ConvexError(
            "Account deletion was not reserved for this owner; refusing to remove ownership",
          );
        }
        const next = ownerIds.filter((id) => id !== userId);
        // Never remove the last real owner. Better Auth has already deleted
        // this user by the time cleanup runs, so a ghost may be all that is
        // left; in that case keep the reservation and flag it for the operator
        // instead of leaving the workspace ownerless.
        const remainingLive = await liveOwnerIdsAmong(ctx, next, server, Date.now());
        if (next.length === 0 || remainingLive.length === 0) {
          // Record the orphaned state once per transition. A retried cleanup or
          // the hourly prune must not append the same audit row forever.
          const alerts = server.ownerDeletionAlerts ?? [];
          if (!alerts.includes(userId)) {
            await ctx.db.patch(server._id, { ownerDeletionAlerts: [...alerts, userId] });
            await writeAudit(ctx, {
              actorId: userId,
              action: "owner.deletion.orphaned",
              targetId: userId,
              meta: JSON.stringify({
                reason: "no-live-owner",
                ownerCount: next.length,
                liveOwnerCount: remainingLive.length,
              }),
            });
          }
        } else {
          const legacyOwnerId = server.ownerId === userId ? next[0] : server.ownerId;
          if (legacyOwnerId === undefined) {
            throw new ConvexError("There must always be at least one owner");
          }
          const alerts = (server.ownerDeletionAlerts ?? []).filter((id) => id !== userId);
          await ctx.db.patch(server._id, {
            ownerIds: next,
            ownerId: legacyOwnerId,
            ownerDeletionReservations: withoutDeletionReservation(server, userId),
            ...(alerts.length !== (server.ownerDeletionAlerts ?? []).length
              ? { ownerDeletionAlerts: alerts }
              : {}),
          });
          await writeAudit(ctx, {
            actorId: userId,
            action: "owner.demote",
            targetId: userId,
            meta: JSON.stringify({ reason: "account-deletion", ownerCount: next.length }),
          });
        }
      } else if (hasReservation) {
        // A non-owner can carry a stale reservation after a retried cleanup.
        await ctx.db.patch(server._id, {
          ownerDeletionReservations: withoutDeletionReservation(server, userId),
        });
      }
    }

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
