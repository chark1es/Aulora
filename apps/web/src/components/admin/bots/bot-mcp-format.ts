/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_MCP_LIMITS, BOT_MCP_PATH, BOT_MCP_TOKEN_PREFIX, type BotMcpScope } from "@aulora/core";
import { formatDate } from "../../../lib/invite-format";

/**
 * Pure helpers for the MCP access page: labels, form validation, the relative
 * dates in the token list and the client setup snippets. No component or
 * server state lives here.
 */

export type McpExpiryDays = (typeof BOT_MCP_LIMITS.expiryDays)[number];
export type McpBotAccess = "all" | "selected";

export const MCP_DEFAULT_EXPIRY_DAYS: McpExpiryDays = 30;

export const MCP_SCOPE_LABELS: Readonly<Record<BotMcpScope, string>> = {
  read: "Read only",
  write: "Read & write",
};

export const MCP_SCOPE_DESCRIPTIONS: Readonly<Record<BotMcpScope, string>> = {
  read: "List bots, read code and logs",
  write: "Also create bots, edit code, set environment variables, enable/disable and restart",
};

export interface McpFormState {
  readonly name: string;
  readonly scope: BotMcpScope;
  readonly access: McpBotAccess;
  readonly botIds: readonly string[];
  readonly expiryDays: McpExpiryDays;
}

export const MCP_INITIAL_FORM: McpFormState = {
  name: "",
  scope: "read",
  access: "all",
  botIds: [],
  expiryDays: MCP_DEFAULT_EXPIRY_DAYS,
};

export function expiryOptionLabel(days: McpExpiryDays): string {
  return days === 365 ? "1 year" : `${days} days`;
}

/** The expiry option for a `Select` value, or `undefined` for an unknown one. */
export function parseExpiryDays(value: string): McpExpiryDays | undefined {
  return BOT_MCP_LIMITS.expiryDays.find((days) => String(days) === value);
}

/** Null when the form can be submitted; otherwise the first problem found. */
export function validateMcpForm(form: McpFormState): string | null {
  const name = form.name.trim();
  if (name.length === 0) {
    return "Give the token a name";
  }
  if (name.length > BOT_MCP_LIMITS.maxNameLength) {
    return `Names are at most ${BOT_MCP_LIMITS.maxNameLength} characters`;
  }
  if (form.access === "selected" && form.botIds.length === 0) {
    return "Choose at least one bot, or allow all bots";
  }
  return null;
}

/** Adds or removes one id, keeping the rest in the order they were picked. */
export function toggleBotId(ids: readonly string[], id: string, selected: boolean): string[] {
  const rest = ids.filter((existing) => existing !== id);
  return selected ? [...rest, id] : rest;
}

/** "All bots", or the names of the bots a token is limited to. */
export function describeMcpBots(
  botIds: readonly string[] | null,
  names: ReadonlyMap<string, string>,
): string {
  if (botIds === null) {
    return "All bots";
  }
  return botIds.map((id) => names.get(id) ?? "Deleted bot").join(", ");
}

/** The token as shown in lists: only the prefix and the last four characters. */
export function maskedMcpToken(last4: string): string {
  return `${BOT_MCP_TOKEN_PREFIX}…${last4}`;
}

const DAY_MS = 86_400_000;

function relativeFuture(ms: number): string {
  if (ms < DAY_MS) {
    return "in under a day";
  }
  const days = Math.ceil(ms / DAY_MS);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

/** "Expires in 29 days (Dec 22, 2026)" or "Expired Nov 1, 2026". */
export function describeMcpExpiry(expiresAt: number, expired: boolean, now: number): string {
  if (expired) {
    return `Expired ${formatDate(expiresAt)}`;
  }
  return `Expires ${relativeFuture(expiresAt - now)} (${formatDate(expiresAt)})`;
}

/** "Never", "Just now", "5 min ago", "3 h ago" or "2 d ago". */
export function describeMcpLastUsed(lastUsedAt: number | null, now: number): string {
  if (lastUsedAt === null) {
    return "Never";
  }
  const minutes = Math.floor((now - lastUsedAt) / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** The MCP endpoint of a workspace, from its public origin. */
export function mcpEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${BOT_MCP_PATH}`;
}

export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http aulora ${url} --header "Authorization: Bearer ${token}"`;
}

export function mcpJsonConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        aulora: { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
}
