import { mutation } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { getTurnSettings } from "./lib/env";
import { loadEffectiveEnv } from "./lib/envOverrides";
import { requireMember } from "./lib/permissions";
import { buildTurnCredentials, type TurnCredentials } from "./lib/turn";

/**
 * Mints a short-lived TURN credential for the signed-in member.
 *
 * This is a mutation, not a query: a query result is cached by the client and
 * by Convex until its inputs change, while a credential expires on a clock. A
 * mutation always re-runs, so a long call that asks again before its TTL runs
 * out gets a fresh username/credential pair.
 *
 * Returns `null` when the deployment has no TURN server configured, in which
 * case clients keep their public-STUN default. No secret is ever returned.
 */
export const credentials = mutation({
  args: {},
  handler: async (ctx): Promise<TurnCredentials | null> => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const env = (await loadEffectiveEnv(ctx)).env;
    const settings = getTurnSettings(env);
    if (settings === null) {
      return null;
    }
    return await buildTurnCredentials({ settings, userId });
  },
});
