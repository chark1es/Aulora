/**
 * Internal functions behind `POST /api/mcp`. Tokens are only ever looked up by
 * SHA-256 hash; nothing here returns, logs or echoes a token. Tool calls
 * re-authorize inside their own transaction, so a creator who loses
 * `ManageBots` (or is banned) between two steps of one request is refused
 * before any write. See `docs/bots-design.md`.
 */
import { BOT_MCP_RATE_LIMIT, type BotMcpScope } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { authorizeMcpToken } from "./lib/botMcpAuth";
import { runReadTool, runWriteTool, type ToolResult } from "./lib/botMcpRun";
import { enforceRateLimit } from "./lib/rateLimit";

/** The non-secret facts the HTTP layer needs after authorizing a request. */
export type McpAuthOutcome =
  | {
      readonly status: "ok";
      readonly tokenId: Id<"botMcpTokens">;
      readonly scope: BotMcpScope;
    }
  | { readonly status: "unauthorized" }
  | { readonly status: "forbidden" };

/** Counts one request against a 120/min bucket keyed by the token hash. */
export const enforceTokenRateLimit = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await enforceRateLimit(ctx, {
      key: `bot-mcp:${args.tokenHash}`,
      limit: BOT_MCP_RATE_LIMIT.limit,
      windowMs: BOT_MCP_RATE_LIMIT.windowMs,
    });
    return null;
  },
});

/** Authorizes a request and refreshes `lastUsedAt` (at most once a minute). */
export const authorize = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<McpAuthOutcome> => {
    const result = await authorizeMcpToken(ctx, args.tokenHash, ctx);
    if (result.status !== "ok") {
      return { status: result.status };
    }
    return { status: "ok", tokenId: result.session.tokenId, scope: result.session.scope };
  },
});

/** The tool arguments travel as JSON text so Convex field-name rules cannot reject them. */
function parseToolArgs(argsJson: string): unknown {
  try {
    return JSON.parse(argsJson);
  } catch {
    throw new ConvexError("Invalid arguments: not valid JSON");
  }
}

const MCP_ACCESS_CHANGED = "This token no longer has access";

export const readTool = internalQuery({
  args: { tokenHash: v.string(), name: v.string(), argsJson: v.string() },
  handler: async (ctx, args): Promise<ToolResult> => {
    const result = await authorizeMcpToken(ctx, args.tokenHash);
    if (result.status !== "ok") {
      throw new ConvexError(MCP_ACCESS_CHANGED);
    }
    return await runReadTool(ctx, result.session, args.name, parseToolArgs(args.argsJson));
  },
});

export const writeTool = internalMutation({
  args: { tokenHash: v.string(), name: v.string(), argsJson: v.string() },
  handler: async (ctx, args): Promise<ToolResult> => {
    const result = await authorizeMcpToken(ctx, args.tokenHash);
    if (result.status !== "ok") {
      throw new ConvexError(MCP_ACCESS_CHANGED);
    }
    return await runWriteTool(ctx, result.session, args.name, parseToolArgs(args.argsJson));
  },
});

const PRUNE_BATCH = 200;
const PRUNE_MAX_BATCHES = 20;

/** Deletes expired tokens in bounded batches (daily cron). */
export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const now = Date.now();
    let deleted = 0;
    for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
      const rows = await ctx.db
        .query("botMcpTokens")
        .withIndex("by_expires", (q) => q.lte("expiresAt", now))
        .take(PRUNE_BATCH);
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      deleted += rows.length;
      if (rows.length < PRUNE_BATCH) {
        break;
      }
    }
    return deleted;
  },
});
