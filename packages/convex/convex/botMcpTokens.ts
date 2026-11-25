/**
 * Admin API for MCP access tokens (Workspace settings -> Bots -> MCP access).
 * Every function requires `Permission.ManageBots`. Only the SHA-256 hash of a
 * token is stored; the plaintext is returned once by `create`. Audit rows carry
 * names and counts, never the token. See `docs/bots-design.md`.
 */
import { BOT_LIMITS, BOT_MCP_LIMITS, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { botMcpTokenLast4, generateBotMcpToken, hashBotMcpToken } from "./lib/botMcpAuth";
import type { BotMcpTokenCreated, BotMcpTokenSummary } from "./lib/botMcpTypes";
import { requireWorkspaceContext } from "./lib/permissions";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Live tokens are capped at `maxTokens`; expired ones linger until the daily
 * prune, so the list reads a window of twice that.
 */
const LIST_WINDOW = BOT_MCP_LIMITS.maxTokens * 2;

function validateTokenName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > BOT_MCP_LIMITS.maxNameLength) {
    throw new ConvexError(`Token names must be 1 to ${BOT_MCP_LIMITS.maxNameLength} characters`);
  }
  return name;
}

function validateExpiry(days: number): number {
  const allowed: readonly number[] = BOT_MCP_LIMITS.expiryDays;
  if (!allowed.includes(days)) {
    throw new ConvexError(`Tokens expire in ${allowed.join(", ")} days`);
  }
  return days;
}

/** Deduplicates and checks that each bot exists; `null` means every bot. */
async function validateBotIds(
  ctx: MutationCtx,
  botIds: readonly Id<"bots">[] | null,
): Promise<Id<"bots">[] | undefined> {
  if (botIds === null) {
    return undefined;
  }
  const unique = [...new Set(botIds)];
  if (unique.length === 0 || unique.length > BOT_LIMITS.maxBots) {
    throw new ConvexError("Choose at least one bot, or allow all bots");
  }
  for (const botId of unique) {
    if ((await ctx.db.get(botId)) === null) {
      throw new ConvexError("Unknown bot in the token's scope");
    }
  }
  return unique;
}

export const list = query({
  args: {},
  handler: async (ctx): Promise<BotMcpTokenSummary[]> => {
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    const rows = await ctx.db.query("botMcpTokens").order("desc").take(LIST_WINDOW);
    const names = await accountNames(
      ctx,
      rows.map((row) => row.createdBy),
    );
    const now = Date.now();
    return rows.map((row) => ({
      id: row._id,
      name: row.name,
      scope: row.scope,
      botIds: row.botIds ?? null,
      tokenLast4: row.tokenLast4,
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) ?? "Unknown member",
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt ?? null,
      expired: row.expiresAt <= now,
    }));
  },
});

/** Issues a token. The plaintext is returned here and nowhere else. */
export const create = mutation({
  args: {
    name: v.string(),
    scope: v.union(v.literal("read"), v.literal("write")),
    botIds: v.union(v.array(v.id("bots")), v.null()),
    expiresInDays: v.number(),
  },
  handler: async (ctx, args): Promise<BotMcpTokenCreated> => {
    const { userId } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const name = validateTokenName(args.name);
    const days = validateExpiry(args.expiresInDays);
    const botIds = await validateBotIds(ctx, args.botIds);
    const now = Date.now();
    const live = await ctx.db
      .query("botMcpTokens")
      .withIndex("by_expires", (q) => q.gt("expiresAt", now))
      .take(BOT_MCP_LIMITS.maxTokens);
    if (live.length >= BOT_MCP_LIMITS.maxTokens) {
      throw new ConvexError(
        `This workspace may have at most ${BOT_MCP_LIMITS.maxTokens} active MCP tokens`,
      );
    }
    const token = generateBotMcpToken();
    const tokenId = await ctx.db.insert("botMcpTokens", {
      name,
      tokenHash: await hashBotMcpToken(token),
      tokenLast4: botMcpTokenLast4(token),
      scope: args.scope,
      ...(botIds !== undefined ? { botIds } : {}),
      createdBy: userId,
      createdAt: now,
      expiresAt: now + days * DAY_MS,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.mcp.token.create",
      targetId: tokenId,
      meta: JSON.stringify({
        name,
        scope: args.scope,
        bots: botIds === undefined ? "all" : botIds.length,
        expiresInDays: days,
      }),
    });
    return { tokenId, token };
  },
});

/** Deletes a token. Any `ManageBots` holder may revoke any token. */
export const revoke = mutation({
  args: { tokenId: v.id("botMcpTokens") },
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const row = await ctx.db.get(args.tokenId);
    if (row === null) {
      throw new ConvexError("Token not found");
    }
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.mcp.token.revoke",
      targetId: row._id,
      meta: JSON.stringify({ name: row.name }),
    });
    return null;
  },
});
