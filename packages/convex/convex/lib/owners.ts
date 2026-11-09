import { isBotUserId } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";

type ReadCtx = QueryCtx | MutationCtx;

/**
 * The owners of a workspace, normalising the legacy single-owner field.
 *
 * `server.ownerId` predates multiple owners and is still written so older
 * clients and restores keep working. A server with only `ownerId` therefore
 * has exactly one owner; a multi-owner server stores the full list in
 * `ownerIds` and keeps `ownerId` equal to its first entry.
 */
export function ownerIdsOf(server: Pick<Doc<"server">, "ownerId" | "ownerIds"> | null): string[] {
  if (server === null) {
    return [];
  }
  const ids = new Set<string>();
  if (server.ownerId.length > 0) {
    ids.add(server.ownerId);
  }
  for (const id of server.ownerIds ?? []) {
    if (id.length > 0) {
      ids.add(id);
    }
  }
  return [...ids];
}

/** Whether `userId` is one of the workspace owners. */
export function isOwner(
  server: Pick<Doc<"server">, "ownerId" | "ownerIds"> | null,
  userId: string,
): boolean {
  return ownerIdsOf(server).includes(userId);
}

export interface OwnerContext {
  readonly userId: string;
  readonly server: Doc<"server">;
  readonly ownerIds: string[];
}

/**
 * Requires a signed-in owner. Owners are peers: every owner passes every
 * owner-only check, including instance settings, environment overrides,
 * backups, updates and owner management itself.
 */
export async function requireOwnerContext(ctx: ReadCtx): Promise<OwnerContext> {
  const { userId } = await requireAuth(ctx);
  const server = await ctx.db.query("server").first();
  if (server === null) {
    throw new ConvexError("Workspace is not initialized");
  }
  const ownerIds = ownerIdsOf(server);
  if (!ownerIds.includes(userId)) {
    throw new ConvexError("Owner only");
  }
  return { userId, server, ownerIds };
}

/** Bots and guests (non-members) can never become owners. */
export function assertOwnerCandidate(userId: string): void {
  if (isBotUserId(userId)) {
    throw new ConvexError("Bots cannot be workspace owners");
  }
}

type ServerOwners = Pick<Doc<"server">, "ownerId" | "ownerIds"> &
  Partial<Pick<Doc<"server">, "ownerDeletionReservations" | "ownerDeletionAlerts">>;

export type { ServerOwners };

/**
 * How long a pending account deletion keeps its ownership reservation before
 * the recovery prune may release it.
 *
 * This is deliberately much longer than any HTTP request or action lifetime:
 * Better Auth removes the auth user in a separate transaction after the
 * reservation is written, so releasing on a shorter TTL could let a stalled
 * deletion A be treated as gone, a peer B pass the last-owner guard, and both
 * deletions complete with no live owner left. One hour gives the whole delete
 * sequence ample time to finish or fail. A retried reservation refreshes
 * `reservedAt`, so a deletion that keeps failing does not lose its place.
 */
export const OWNER_DELETION_RESERVATION_GRACE_MS = 60 * 60_000;

export interface OwnerDeletionReservation {
  readonly userId: string;
  readonly reservedAt: number;
}

/**
 * Reservations that count against the last-owner guard. A reservation stays
 * active past its grace period until the recovery prune explicitly releases it:
 * time alone is not proof that the auth user survived, because Better Auth may
 * still be between the reservation and its own delete. This fails closed, so a
 * stopped cron can lock out account deletion but can never strand a workspace
 * with no owner.
 */
export function activeDeletionReservations(
  server: ServerOwners | null,
  // Kept in the signature so callers can pass a test clock; reservations are
  // intentionally not filtered by time (see the doc comment above).
  _now: number = Date.now(),
): OwnerDeletionReservation[] {
  return [...(server?.ownerDeletionReservations ?? [])];
}

/** Reservations old enough for the recovery prune to inspect and release. */
export function pruneableDeletionReservations(
  server: ServerOwners | null,
  now: number = Date.now(),
): OwnerDeletionReservation[] {
  if (server === null) {
    return [];
  }
  return (server.ownerDeletionReservations ?? []).filter(
    (reservation) => reservation.reservedAt + OWNER_DELETION_RESERVATION_GRACE_MS <= now,
  );
}

/** The flagged orphan ids stored on the server, normalised for callers. */
export function ownerDeletionAlerts(server: ServerOwners | null): string[] {
  return [...(server?.ownerDeletionAlerts ?? [])];
}

/** Removes one reservation while keeping every other stored row untouched. */
export function withoutDeletionReservation(
  server: ServerOwners | null,
  userId: string,
): OwnerDeletionReservation[] {
  return (server?.ownerDeletionReservations ?? []).filter(
    (reservation) => reservation.userId !== userId,
  );
}
