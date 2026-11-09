import { isBotUserId } from "@aulora/core";
import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "../_generated/dataModel";
import { authComponent } from "../auth";
import { activeDeletionReservations, ownerIdsOf, type ServerOwners } from "./owners";

/**
 * Whether an owner id still has a Better Auth user.
 *
 * `gone` is a ghost: a user id left in `ownerIds` after the auth user was
 * removed but the workspace cleanup never ran. `unknown` means the lookup itself
 * failed (a transient component error, or a context without the component), so
 * callers must fail closed instead of assuming the owner is present.
 */
export type OwnerLiveness = "live" | "gone" | "unknown";

/** Bots are never owners, but a legacy id must not look like a ghost. */
export async function ownerLiveness(
  ctx: GenericCtx<DataModel>,
  userId: string,
): Promise<OwnerLiveness> {
  if (isBotUserId(userId)) {
    return "live";
  }
  try {
    const user = await authComponent.getAnyUserById(ctx, userId);
    return user === null ? "gone" : "live";
  } catch {
    return "unknown";
  }
}

/**
 * Owner ids from an explicit list that are still expected to be present.
 * Use this when evaluating a proposed `ownerIds` write: {@link ownerIdsOf}
 * always re-adds the legacy `ownerId`, which would resurrect the owner being
 * removed.
 */
export async function liveOwnerIdsAmong(
  ctx: GenericCtx<DataModel>,
  ids: readonly string[],
  server: ServerOwners | null,
  now: number = Date.now(),
): Promise<string[]> {
  const pending = new Set(activeDeletionReservations(server, now).map((row) => row.userId));
  const live: string[] = [];
  for (const userId of ids) {
    if (pending.has(userId)) {
      continue;
    }
    if ((await ownerLiveness(ctx, userId)) === "live") {
      live.push(userId);
    }
  }
  return live;
}

/**
 * Owner ids that are still expected to be present: stored owners whose auth user
 * exists and that are not in the middle of an active pending deletion.
 *
 * A ghost does not count as live, so the last-owner guard refuses to remove the
 * only real owner. A failed lookup is also excluded (fail closed): without proof
 * that an owner is real, removal is refused rather than risking an ownerless
 * workspace.
 */
export async function liveOwnerIdsChecked(
  ctx: GenericCtx<DataModel>,
  server: ServerOwners | null,
  now: number = Date.now(),
): Promise<string[]> {
  return await liveOwnerIdsAmong(ctx, ownerIdsOf(server), server, now);
}
