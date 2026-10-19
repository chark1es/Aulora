/**
 * Internal functions behind `POST /bots/token`. Tokens are only ever looked up
 * by SHA-256 hash; nothing here returns, logs or echoes a token or key.
 * See `docs/bots-design.md`.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { enforceRateLimit } from "./lib/rateLimit";

/** The non-secret identity the token-exchange route needs. */
export interface BotTokenIdentity {
  readonly botId: Id<"bots">;
  readonly userId: string;
  readonly name: string;
  readonly enabled: boolean;
}

/**
 * Resolves a bot from a token hash, trying the external token index first and
 * then the runner-injected hosted token index. Either token works.
 */
export const findByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<BotTokenIdentity | null> => {
    const external = await ctx.db
      .query("bots")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    const row =
      external ??
      (await ctx.db
        .query("bots")
        .withIndex("by_hosted_token_hash", (q) => q.eq("hostedTokenHash", args.tokenHash))
        .unique());
    if (row === null) {
      return null;
    }
    return { botId: row._id, userId: row.userId, name: row.name, enabled: row.enabled };
  },
});

/** Counts one token exchange against a 60/min bucket keyed by the token hash. */
export const enforceTokenRateLimit = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await enforceRateLimit(ctx, {
      key: `bot-token:${args.tokenHash}`,
      limit: 60,
      windowMs: 60_000,
    });
    return null;
  },
});
