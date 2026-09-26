import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export interface AuthenticatedUser {
  /** Better Auth user id, which is also the Convex JWT subject. */
  readonly userId: string;
}

/**
 * Requires a valid Convex-validated Better Auth JWT and returns the user id.
 * Throws for anonymous callers. Server code is the source of truth; the client
 * copy of the permission logic only hides UI.
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser> {
  const identity = await ctx.auth.getUserIdentity();
  const userId = identity?.subject;
  if (userId === undefined || userId.length === 0) {
    throw new ConvexError("Not authenticated");
  }
  return { userId };
}
