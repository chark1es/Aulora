import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { liveOwnerIdsAmong, liveOwnerIdsChecked, ownerLiveness } from "./lib/ownerLiveness";
import {
  activeDeletionReservations,
  assertOwnerCandidate,
  ownerDeletionAlerts,
  ownerIdsOf,
  pruneableDeletionReservations,
  requireOwnerContext,
  withoutDeletionReservation,
} from "./lib/owners";

/**
 * Multiple workspace owners.
 *
 * Owners are peers: every owner passes every owner-only check (instance
 * settings, environment overrides, backups, updates, roles, invites, bots and
 * owner management). Only an existing owner may add or remove another, and the
 * last owner can never be removed or demoted. Bots and non-members cannot be
 * promoted.
 *
 * This release has no separate password re-authentication / step-up primitive;
 * promotion therefore relies on an active owner session plus the client's
 * confirmation dialog, and every change is audited with actor, target and
 * time. There is no generic account-event notification transport in the
 * workspace, so the target sees the new badge and permissions live in the
 * members surface instead of receiving a push.
 */

export const promote = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: actorId, server, ownerIds } = await requireOwnerContext(ctx);
    assertOwnerCandidate(args.userId);

    if (ownerIds.includes(args.userId)) {
      return null;
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (member === null) {
      throw new ConvexError("Only an existing member can become an owner");
    }

    const next = [...ownerIds, args.userId];
    await ctx.db.patch(server._id, { ownerIds: next });
    await writeAudit(ctx, {
      actorId,
      action: "owner.promote",
      targetId: args.userId,
      meta: JSON.stringify({ ownerCount: next.length }),
    });
    return null;
  },
});

export const demote = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: actorId, server, ownerIds } = await requireOwnerContext(ctx);
    if (!ownerIds.includes(args.userId)) {
      throw new ConvexError("That member is not an owner");
    }
    const now = Date.now();
    const next = ownerIds.filter((id) => id !== args.userId);
    // Count owners whose account deletion is already pending as leaving, and
    // treat an owner whose auth user is gone (a ghost from an interrupted
    // account deletion) as not live. Without that, the ghost could satisfy the
    // last-owner guard while the only real owner is demoted away.
    const remainingLive = await liveOwnerIdsAmong(ctx, next, server, now);
    const legacyOwnerId = server.ownerId === args.userId ? next[0] : server.ownerId;
    if (remainingLive.length === 0 || legacyOwnerId === undefined) {
      throw new ConvexError("There must always be at least one owner");
    }
    await ctx.db.patch(server._id, {
      ownerIds: next,
      ownerId: legacyOwnerId,
      // Demoting an owner also resolves any pending deletion for them, but an
      // expired reservation for anyone else is left for the recovery prune.
      ownerDeletionReservations: withoutDeletionReservation(server, args.userId),
    });
    await writeAudit(ctx, {
      actorId,
      action: "owner.demote",
      targetId: args.userId,
      meta: JSON.stringify({ ownerCount: next.length }),
    });
    return null;
  },
});

/**
 * Blocks deleting the last owner's account before Better Auth removes it.
 * Account deletion is the only "leave" path in the app, so this is what keeps
 * a workspace from becoming ownerless.
 */
export const deletionCheck = internalQuery({
  args: { userId: v.string() },
  returns: v.object({ allowed: v.boolean(), reason: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server === null) {
      return { allowed: true, reason: null };
    }
    const ownerIds = ownerIdsOf(server);
    if (!ownerIds.includes(args.userId)) {
      return { allowed: true, reason: null };
    }
    // A deletion already reserved for this owner is idempotent; otherwise the
    // owner must not be the last one still expected to be present. This check
    // runs before Better Auth removes anything: `beforeDelete` calls it, then
    // reserves the transition atomically.
    const alreadyPending = activeDeletionReservations(server).some(
      (reservation) => reservation.userId === args.userId,
    );
    if (!alreadyPending) {
      const live = await liveOwnerIdsChecked(ctx, server);
      if (live.length <= 1) {
        return {
          allowed: false,
          reason:
            "You are the only owner. Make another member an owner before deleting your account.",
        };
      }
    }
    return { allowed: true, reason: null };
  },
});

const lastOwnerReason =
  "You are the only owner. Make another member an owner before deleting your account.";

/**
 * Atomically reserves an owner's pending account deletion. Better Auth calls
 * this from `beforeDelete`, before it removes its own user row.
 *
 * The reservation is what makes the last-owner guarantee safe under
 * concurrency: two owners deleting at the same time serialize on the
 * `server.ownerDeletionReservations` write, and the second one sees the first
 * reservation and refuses. The owner stays in `ownerIds` until
 * {@link deleteUserData} commits the removal, so a failed Better Auth deletion
 * leaves the workspace unchanged; the reservation expires and is pruned.
 */
export const reserveAccountDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server === null) {
      return null;
    }
    const ownerIds = ownerIdsOf(server);
    if (!ownerIds.includes(args.userId)) {
      return null;
    }
    const now = Date.now();
    const pending = activeDeletionReservations(server, now);
    if (pending.some((reservation) => reservation.userId === args.userId)) {
      // A retried deletion keeps its reservation, and refreshing the timestamp
      // restarts the grace period. The cleanup may still be between this
      // reservation and Better Auth's own delete transaction, so the guard must
      // not start treating it as stalled while retries keep arriving.
      const refreshed = (server.ownerDeletionReservations ?? []).map((reservation) =>
        reservation.userId === args.userId ? { ...reservation, reservedAt: now } : reservation,
      );
      await ctx.db.patch(server._id, { ownerDeletionReservations: refreshed });
      return null;
    }
    // Never let a ghost (or an id whose liveness cannot be checked) satisfy the
    // last-owner guard. This runs before Better Auth deletes the auth user, so
    // the workspace is never left ownerless by a check that happens too late.
    const self = await ownerLiveness(ctx, args.userId);
    if (self === "unknown") {
      throw new ConvexError(lastOwnerReason);
    }
    if (self === "live") {
      const live = await liveOwnerIdsChecked(ctx, server, now);
      if (live.length <= 1) {
        throw new ConvexError(lastOwnerReason);
      }
    }
    const reservations = [
      ...(server.ownerDeletionReservations ?? []).filter(
        (reservation) => reservation.userId !== args.userId,
      ),
      { userId: args.userId, reservedAt: now },
    ];
    await ctx.db.patch(server._id, { ownerDeletionReservations: reservations });
    await writeAudit(ctx, {
      actorId: args.userId,
      action: "owner.deletion.reserved",
      targetId: args.userId,
      meta: JSON.stringify({ ownerCount: (await liveOwnerIdsChecked(ctx, server, now)).length }),
    });
    return null;
  },
});

/**
 * Recovers reservations whose deletion never completed.
 *
 * It never just drops an expired reservation:
 *
 * - the auth user still exists: the deletion failed before anything was
 *   removed, so the reservation is released and the owner stays live;
 * - the auth user is gone: the owner is a ghost. `deleteUserData` is scheduled
 *   to finish the cleanup idempotently. It removes the ghost from `ownerIds`
 *   only when another live owner remains; otherwise it keeps the reservation
 *   and writes an operator-facing audit row.
 * - the liveness lookup fails: keep the reservation and flag it. The last-owner
 *   guard also treats the owner as not live, so it fails closed.
 */
export const pruneAccountDeletionReservations = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server === null) {
      return 0;
    }
    const now = Date.now();
    const ownerIds = ownerIdsOf(server);
    const reservations = server.ownerDeletionReservations ?? [];
    const prunable = new Set(pruneableDeletionReservations(server, now).map((row) => row.userId));
    const alerts = new Set(ownerDeletionAlerts(server));
    let alertsChanged = false;
    const scheduled = new Set<string>();
    const scheduleCleanup = async (userId: string): Promise<void> => {
      if (scheduled.has(userId)) {
        return;
      }
      scheduled.add(userId);
      await ctx.scheduler.runAfter(0, internal.accountDeletion.deleteUserData, { userId });
    };
    const flag = async (userId: string, meta: Record<string, unknown>): Promise<void> => {
      if (alerts.has(userId)) {
        return;
      }
      alerts.add(userId);
      alertsChanged = true;
      await writeAudit(ctx, {
        actorId: "system",
        action: "owner.deletion.orphaned",
        targetId: userId,
        meta: JSON.stringify(meta),
      });
    };

    const keep: typeof reservations = [];
    let released = 0;
    for (const reservation of reservations) {
      if (!prunable.has(reservation.userId)) {
        keep.push(reservation);
        continue;
      }
      const liveness = await ownerLiveness(ctx, reservation.userId);
      if (liveness === "live") {
        // The grace period passed with the auth user still present. The delete
        // either failed before Better Auth ran or its transaction was lost, so
        // the owner stays and the reservation is released.
        released += 1;
        if (alerts.delete(reservation.userId)) {
          alertsChanged = true;
        }
        continue;
      }
      // Keep the row until the idempotent cleanup decides whether the ghost can
      // be removed. Dropping it here would make `deleteUserData` fail closed.
      keep.push(reservation);
      if (liveness === "gone") {
        await scheduleCleanup(reservation.userId);
      } else {
        await flag(reservation.userId, { reason: "auth-lookup-unavailable" });
      }
    }

    // Check the stored owner ids themselves, not only reservations. A ghost can
    // have no reservation at all when an upgrade or a race lost it, or when an
    // older release removed the auth user without reserving. Healing is safe
    // only while another live owner remains; otherwise flag it for the operator.
    const reservedIds = new Set(reservations.map((row) => row.userId));
    for (const ownerId of ownerIds) {
      if (reservedIds.has(ownerId)) {
        continue;
      }
      if ((await ownerLiveness(ctx, ownerId)) !== "gone") {
        // A flag left from an earlier run is no longer true once the auth user
        // is back; clear it so a later incident can record its own transition.
        if (alerts.delete(ownerId)) {
          alertsChanged = true;
        }
        continue;
      }
      const others = ownerIds.filter((id) => id !== ownerId);
      const liveOthers = await liveOwnerIdsAmong(
        ctx,
        others,
        {
          ownerId: server.ownerId,
          ownerIds,
          ownerDeletionReservations: keep,
        },
        now,
      );
      if (liveOthers.length > 0) {
        // Give `deleteUserData` the reservation it requires, then let the
        // idempotent cleanup remove the ghost and its personal rows.
        keep.push({ userId: ownerId, reservedAt: now });
        reservedIds.add(ownerId);
        await scheduleCleanup(ownerId);
      } else {
        await flag(ownerId, {
          reason: "no-live-owner",
          source: "ghost",
          ownerCount: ownerIds.length,
          liveOwnerCount: 0,
        });
      }
    }

    const storedAlerts = server.ownerDeletionAlerts ?? [];
    const nextAlerts = [...alerts];
    const alertsDiffer =
      alertsChanged ||
      nextAlerts.length !== storedAlerts.length ||
      nextAlerts.some((id, index) => id !== storedAlerts[index]);
    if (released > 0 || keep.length !== reservations.length || alertsDiffer) {
      await ctx.db.patch(server._id, {
        ownerDeletionReservations: keep,
        ...(alertsDiffer ? { ownerDeletionAlerts: nextAlerts } : {}),
      });
    }
    return released;
  },
});
