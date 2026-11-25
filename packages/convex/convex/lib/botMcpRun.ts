import { BOT_LIMITS, type BotLanguage, permissionNames } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { botFileByteLength, openBotEnv, openBotFileContent, validateBotFilePath } from "./botFiles";
import { type BotDoc, requireCanControlBot } from "./botManagement";
import {
  type ArgMap,
  optArray,
  optBoolean,
  optEnum,
  optInteger,
  optString,
  readArgs,
  reqEnum,
  reqString,
  stringItem,
} from "./botMcpArgs";
import type { McpSession } from "./botMcpAuth";
import {
  createBotAs,
  readBotLogs,
  readRunnerStatus,
  restartBotAs,
  saveBotFilesAs,
  setBotEnvAs,
  updateBotAs,
} from "./botOperations";

/**
 * Executes MCP tools for an authorized session. Read tools accept a query or
 * mutation context; write tools need a mutation. Every tool re-validates its
 * arguments, and a bot outside the token's `botIds` is "not found" so the
 * restriction cannot be used to probe which bots exist.
 */

type ReadCtx = QueryCtx | MutationCtx;

/** A JSON-serializable tool result. */
export type ToolResult = Record<string, unknown>;

const LANGUAGES: readonly BotLanguage[] = ["typescript", "python"];
const DEFAULT_LOG_LINES = 100;

async function fileCount(ctx: ReadCtx, botId: Id<"bots">): Promise<number> {
  const rows = await ctx.db
    .query("botFiles")
    .withIndex("by_bot_path", (q) => q.eq("botId", botId))
    .take(BOT_LIMITS.maxFiles + 1);
  return rows.length;
}

async function summarize(ctx: ReadCtx, bot: BotDoc): Promise<ToolResult> {
  return {
    id: bot._id,
    name: bot.name,
    description: bot.description ?? null,
    language: bot.language,
    enabled: bot.enabled,
    status: bot.status,
    statusMessage: bot.statusMessage ?? null,
    revision: bot.revision,
    fileCount: await fileCount(ctx, bot._id),
    grants: permissionNames(bot.grants),
  };
}

/** The bot if it exists and the token may see it; otherwise "Bot not found". */
async function loadVisibleBot(ctx: ReadCtx, session: McpSession, rawId: string): Promise<BotDoc> {
  const botId = ctx.db.normalizeId("bots", rawId);
  if (botId === null || (session.botIds !== null && !session.botIds.includes(botId))) {
    throw new ConvexError("Bot not found");
  }
  const bot = await ctx.db.get(botId);
  if (bot === null) {
    throw new ConvexError("Bot not found");
  }
  return bot;
}

/** A visible bot the creator may also control (the `requireCanControlBot` ceiling). */
async function loadControlledBot(ctx: ReadCtx, session: McpSession, args: ArgMap): Promise<BotDoc> {
  const bot = await loadVisibleBot(ctx, session, reqString(args, "botId"));
  requireCanControlBot(session.actor.context, bot);
  return bot;
}

async function listBots(ctx: ReadCtx, session: McpSession): Promise<ToolResult> {
  const rows = await ctx.db.query("bots").take(BOT_LIMITS.maxBots);
  const bots: ToolResult[] = [];
  for (const bot of rows) {
    if (session.botIds === null || session.botIds.includes(bot._id)) {
      bots.push(await summarize(ctx, bot));
    }
  }
  return { bots };
}

async function getBot(ctx: ReadCtx, session: McpSession, args: ArgMap): Promise<ToolResult> {
  const bot = await loadVisibleBot(ctx, session, reqString(args, "botId"));
  const rows = await ctx.db
    .query("botFiles")
    .withIndex("by_bot_path", (q) => q.eq("botId", bot._id))
    .take(BOT_LIMITS.maxFiles);
  const files = [];
  for (const row of rows) {
    const content = await openBotFileContent(bot._id, row.contentCiphertext);
    files.push({ path: row.path, bytes: botFileByteLength(content) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const env = await openBotEnv(bot._id, bot.envCiphertext);
  return {
    ...(await summarize(ctx, bot)),
    files,
    envNames: [...env.keys()].sort(),
    allowedChannelIds: bot.allowedChannelIds ?? null,
  };
}

async function readFile(ctx: ReadCtx, session: McpSession, args: ArgMap): Promise<ToolResult> {
  const bot = await loadVisibleBot(ctx, session, reqString(args, "botId"));
  const path = validateBotFilePath(reqString(args, "path"));
  const row = await ctx.db
    .query("botFiles")
    .withIndex("by_bot_path", (q) => q.eq("botId", bot._id).eq("path", path))
    .unique();
  if (row === null) {
    throw new ConvexError("File not found");
  }
  const content = await openBotFileContent(bot._id, row.contentCiphertext);
  return { path, bytes: botFileByteLength(content), content };
}

async function readLogs(ctx: ReadCtx, session: McpSession, args: ArgMap): Promise<ToolResult> {
  const bot = await loadVisibleBot(ctx, session, reqString(args, "botId"));
  const limit = optInteger(args, "limit", 1, BOT_LIMITS.maxLogLines) ?? DEFAULT_LOG_LINES;
  return { lines: await readBotLogs(ctx, bot._id, limit) };
}

async function createBot(ctx: MutationCtx, session: McpSession, args: ArgMap): Promise<ToolResult> {
  if (session.botIds !== null) {
    throw new ConvexError("This token is restricted to specific bots and cannot create new ones");
  }
  const { botId } = await createBotAs(ctx, session.actor, {
    name: reqString(args, "name"),
    description: optString(args, "description"),
    language: reqEnum(args, "language", LANGUAGES),
    template: optEnum(args, "template", ["hello", "blank"]),
  });
  const bot = await ctx.db.get(botId);
  return bot === null ? { id: botId } : await summarize(ctx, bot);
}

async function updateBot(ctx: MutationCtx, session: McpSession, args: ArgMap): Promise<ToolResult> {
  const bot = await loadControlledBot(ctx, session, args);
  await updateBotAs(ctx, session.actor, bot, {
    name: optString(args, "name"),
    description: optString(args, "description"),
    language: optEnum(args, "language", LANGUAGES),
    enabled: optBoolean(args, "enabled"),
  });
  const updated = await ctx.db.get(bot._id);
  return updated === null ? { id: bot._id } : await summarize(ctx, updated);
}

function fileItem(item: unknown): { path: string; content: string } {
  const entry = readArgs(item, ["path", "content"]);
  return { path: reqString(entry, "path"), content: reqString(entry, "content") };
}

function envItem(item: unknown): { name: string; value: string } {
  const entry = readArgs(item, ["name", "value"]);
  return { name: reqString(entry, "name"), value: reqString(entry, "value") };
}

async function revisionOf(ctx: ReadCtx, botId: Id<"bots">): Promise<number | null> {
  return (await ctx.db.get(botId))?.revision ?? null;
}

async function writeFiles(
  ctx: MutationCtx,
  session: McpSession,
  args: ArgMap,
): Promise<ToolResult> {
  const bot = await loadControlledBot(ctx, session, args);
  const files = optArray(args, "files", BOT_LIMITS.maxFiles, fileItem) ?? [];
  const deletePaths = optArray(args, "deletePaths", BOT_LIMITS.maxFiles, stringItem) ?? [];
  if (files.length === 0 && deletePaths.length === 0) {
    throw new ConvexError("Invalid arguments: provide files, deletePaths or both");
  }
  await saveBotFilesAs(ctx, session.actor, bot._id, files, deletePaths);
  return {
    revision: await revisionOf(ctx, bot._id),
    saved: files.map((file) => file.path),
    deleted: deletePaths,
  };
}

async function setEnv(ctx: MutationCtx, session: McpSession, args: ArgMap): Promise<ToolResult> {
  const bot = await loadControlledBot(ctx, session, args);
  const entries = optArray(args, "set", BOT_LIMITS.maxEnvVars, envItem) ?? [];
  const remove = optArray(args, "remove", BOT_LIMITS.maxEnvVars, stringItem) ?? [];
  if (entries.length === 0 && remove.length === 0) {
    throw new ConvexError("Invalid arguments: provide set, remove or both");
  }
  await setBotEnvAs(ctx, session.actor, bot._id, entries, remove);
  const updated = await ctx.db.get(bot._id);
  const env = await openBotEnv(bot._id, updated?.envCiphertext);
  return { revision: updated?.revision ?? null, envNames: [...env.keys()].sort() };
}

async function restartBot(
  ctx: MutationCtx,
  session: McpSession,
  args: ArgMap,
): Promise<ToolResult> {
  const bot = await loadControlledBot(ctx, session, args);
  await restartBotAs(ctx, session.actor, bot);
  return { id: bot._id, restartNonce: bot.restartNonce + 1 };
}

type ReadHandler = (ctx: ReadCtx, session: McpSession, args: ArgMap) => Promise<ToolResult>;
type WriteHandler = (ctx: MutationCtx, session: McpSession, args: ArgMap) => Promise<ToolResult>;

/** Argument names each tool accepts; anything else is rejected. */
const READ_TOOLS: ReadonlyMap<string, { keys: readonly string[]; run: ReadHandler }> = new Map([
  ["list_bots", { keys: [], run: listBots }],
  ["get_bot", { keys: ["botId"], run: getBot }],
  ["read_file", { keys: ["botId", "path"], run: readFile }],
  ["read_logs", { keys: ["botId", "limit"], run: readLogs }],
  [
    "get_runner_status",
    {
      keys: [],
      run: async (ctx: ReadCtx) => ({ ...(await readRunnerStatus(ctx)) }),
    },
  ],
]);

const WRITE_TOOLS: ReadonlyMap<string, { keys: readonly string[]; run: WriteHandler }> = new Map([
  ["create_bot", { keys: ["name", "language", "description", "template"], run: createBot }],
  ["update_bot", { keys: ["botId", "name", "description", "language", "enabled"], run: updateBot }],
  ["write_files", { keys: ["botId", "files", "deletePaths"], run: writeFiles }],
  ["set_env", { keys: ["botId", "set", "remove"], run: setEnv }],
  ["restart_bot", { keys: ["botId"], run: restartBot }],
]);

/** True for tools that only read, so the HTTP layer can use a query. */
export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

export async function runReadTool(
  ctx: ReadCtx,
  session: McpSession,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const tool = READ_TOOLS.get(name);
  if (tool === undefined) {
    throw new ConvexError("Unknown tool");
  }
  return await tool.run(ctx, session, readArgs(rawArgs, tool.keys));
}

export async function runWriteTool(
  ctx: MutationCtx,
  session: McpSession,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const tool = WRITE_TOOLS.get(name);
  if (tool === undefined || session.scope !== "write") {
    throw new ConvexError("Unknown tool");
  }
  return await tool.run(ctx, session, readArgs(rawArgs, tool.keys));
}
