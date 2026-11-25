/**
 * Shared constants for the bot-management MCP server. Tokens are issued by a
 * workspace admin (`botMcpTokens.create`) and used by AI clients as
 * `Authorization: Bearer amt_...` against `POST /api/mcp`. See
 * `docs/bots-design.md`.
 */

/** MCP access tokens are `amt_` followed by 43 base64url characters (256 random bits). */
export const BOT_MCP_TOKEN_PREFIX = "amt_";

/** Where the Convex HTTP route lives, relative to the site origin. */
export const BOT_MCP_PATH = "/api/mcp";

/** `read` can inspect bots; `write` can also create, edit and restart them. */
export const BOT_MCP_SCOPES = ["read", "write"] as const;
export type BotMcpScope = (typeof BOT_MCP_SCOPES)[number];

/** Limits enforced by the server; the admin UI mirrors them. */
export const BOT_MCP_LIMITS = {
  maxTokens: 25,
  maxNameLength: 64,
  /** Allowed token lifetimes in days. */
  expiryDays: [7, 30, 90, 365],
} as const;

/** Requests a single token may make per minute. */
export const BOT_MCP_RATE_LIMIT = { limit: 120, windowMs: 60_000 } as const;

/** Largest JSON-RPC request body the endpoint reads, in bytes. */
export const BOT_MCP_MAX_BODY_BYTES = 2 * 1024 * 1024;
