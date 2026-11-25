import { BOT_MCP_TOKEN_PREFIX, type BotMcpScope, hasPermission, Permission } from "@aulora/core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { mayParticipate } from "./bans";
import { botTokenLast4, hashBotToken } from "./botAuth";
import type { BotActor } from "./botOperations";
import { loadPermissionContext, type PermissionContext, workspacePermissions } from "./permissions";

/**
 * Authorization of one MCP request. A token is never stronger than its creator
 * right now: the creator's live membership, ban state and `ManageBots` are
 * re-checked on every call. See `docs/bots-design.md`.
 */

/** `lastUsedAt` is refreshed at most this often to avoid write contention. */
export const LAST_USED_REFRESH_MS = 60_000;

const TOKEN_PATTERN = /^amt_[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** A new MCP token: `amt_` plus 256 random bits as 43 base64url characters. */
export function generateBotMcpToken(): string {
  return `${BOT_MCP_TOKEN_PREFIX}${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/** True when `candidate` has the shape of an MCP token (cheap, before any hashing). */
export function looksLikeBotMcpToken(candidate: string): boolean {
  return TOKEN_PATTERN.test(candidate);
}

/** SHA-256 hex of a token; the only form that is stored or looked up. */
export async function hashBotMcpToken(secret: string): Promise<string> {
  return await hashBotToken(secret);
}

export function botMcpTokenLast4(secret: string): string {
  return botTokenLast4(secret);
}

/** What the tool layer receives once a request is authorized. */
export interface McpSession {
  readonly tokenId: Id<"botMcpTokens">;
  readonly scope: BotMcpScope;
  /** `null` means every bot. */
  readonly botIds: readonly Id<"bots">[] | null;
  readonly actor: BotActor;
}

export type McpAuthResult =
  | { readonly status: "ok"; readonly session: McpSession }
  | { readonly status: "unauthorized" }
  | { readonly status: "forbidden" };

type ReadCtx = QueryCtx | MutationCtx;

/** The creator's live context, or `null` when they may no longer manage bots. */
async function creatorContext(ctx: ReadCtx, userId: string): Promise<PermissionContext | null> {
  let context: PermissionContext;
  try {
    context = await loadPermissionContext(ctx, userId);
  } catch {
    return null;
  }
  if (!(await mayParticipate(ctx, userId))) {
    return null;
  }
  return hasPermission(workspacePermissions(context), Permission.ManageBots) ? context : null;
}

function toSession(row: Doc<"botMcpTokens">, context: PermissionContext): McpSession {
  return {
    tokenId: row._id,
    scope: row.scope,
    botIds: row.botIds ?? null,
    actor: { userId: row.createdBy, context, via: { tokenId: row._id } },
  };
}

/**
 * Resolves a token hash to a session. Unknown and expired tokens are
 * indistinguishable (`unauthorized`). Pass `touch` from a mutation to refresh
 * `lastUsedAt` (at most once per {@link LAST_USED_REFRESH_MS}).
 */
export async function authorizeMcpToken(
  ctx: ReadCtx,
  tokenHash: string,
  touch?: MutationCtx,
): Promise<McpAuthResult> {
  const row = await ctx.db
    .query("botMcpTokens")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  const now = Date.now();
  if (row === null || row.expiresAt <= now) {
    return { status: "unauthorized" };
  }
  const context = await creatorContext(ctx, row.createdBy);
  if (context === null) {
    return { status: "forbidden" };
  }
  if (
    touch !== undefined &&
    (row.lastUsedAt === undefined || now - row.lastUsedAt >= LAST_USED_REFRESH_MS)
  ) {
    await touch.db.patch(row._id, { lastUsedAt: now });
  }
  return { status: "ok", session: toSession(row, context) };
}
