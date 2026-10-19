import { BOT_LIMITS, type BotLanguage, canGrantPermissions } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  botFileByteLength,
  openBotEnv,
  openBotFileContent,
  sealBotEnv,
  sealBotFileContent,
  validateBotFilePath,
} from "./botFiles";
import { type BotTemplateName, starterFiles } from "./botTemplates";
import type { BotDetail, BotSummary } from "./botTypes";
import { adjustMemberCount } from "./memberCount";
import { type PermissionContext, workspacePermissions } from "./permissions";

/**
 * Shared read/validate/mutate helpers behind `bots.ts`. Handlers stay thin;
 * these functions own the shapes the admin UI contracts on and keep every
 * secret column sealed or hashed.
 */

export type BotDoc = Doc<"bots">;

/** A runner heartbeat within this window means the container is online. */
export const RUNNER_ONLINE_MS = 30_000;
export const DEFAULT_LOG_LIMIT = 200;

export async function requireBot(ctx: QueryCtx | MutationCtx, botId: Id<"bots">): Promise<BotDoc> {
  const bot = await ctx.db.get(botId);
  if (bot === null) {
    throw new ConvexError("Bot not found");
  }
  return bot;
}

/**
 * Editing a bot's code, environment or token is acting as that bot, so an admin
 * may only do it for a bot whose grants they could hand out themselves. Without
 * this, ManageBots plus a powerful bot would be a way around the grant ceiling.
 */
export function requireCanControlBot(context: PermissionContext, bot: BotDoc): void {
  if (!canGrantPermissions(workspacePermissions(context), bot.grants)) {
    throw new ConvexError("This bot has permissions you do not hold");
  }
}

export function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > BOT_LIMITS.maxNameLength) {
    throw new ConvexError(`Bot names must be 1 to ${BOT_LIMITS.maxNameLength} characters`);
  }
  return name;
}

export function validateDescription(raw: string): string | undefined {
  const description = raw.trim();
  if (description.length > BOT_LIMITS.maxDescriptionLength) {
    throw new ConvexError(
      `Descriptions must be at most ${BOT_LIMITS.maxDescriptionLength} characters`,
    );
  }
  return description.length > 0 ? description : undefined;
}

/** Rejects a name that another bot already uses, ignoring case. */
export async function assertNameFree(
  ctx: QueryCtx | MutationCtx,
  name: string,
  exceptId?: Id<"bots">,
): Promise<void> {
  const target = name.toLowerCase();
  for (const bot of await ctx.db.query("bots").collect()) {
    if (bot._id !== exceptId && bot.name.toLowerCase() === target) {
      throw new ConvexError("A bot with that name already exists");
    }
  }
}

export function toSummary(bot: BotDoc): BotSummary {
  return {
    id: bot._id,
    userId: bot.userId,
    name: bot.name,
    description: bot.description ?? null,
    language: bot.language,
    enabled: bot.enabled,
    grants: bot.grants,
    allowedChannelIds: bot.allowedChannelIds ?? null,
    status: bot.status,
    statusMessage: bot.statusMessage ?? null,
    statusAt: bot.statusAt,
    hasToken: bot.tokenHash !== undefined,
    tokenLast4: bot.tokenLast4 ?? null,
    createdBy: bot.createdBy,
    createdAt: bot.createdAt,
    revision: bot.revision,
  };
}

export async function toDetail(ctx: QueryCtx | MutationCtx, bot: BotDoc): Promise<BotDetail> {
  const fileRows = await ctx.db
    .query("botFiles")
    .withIndex("by_bot_path", (q) => q.eq("botId", bot._id))
    .collect();
  const files = [];
  for (const row of fileRows) {
    files.push({
      path: row.path,
      content: await openBotFileContent(bot._id, row.contentCiphertext),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const env = await openBotEnv(bot._id, bot.envCiphertext);
  return { ...toSummary(bot), files, envNames: [...env.keys()].sort() };
}

export async function seedStarterFiles(
  ctx: MutationCtx,
  botId: Id<"bots">,
  botLanguage: BotLanguage,
  templateName: BotTemplateName,
): Promise<void> {
  for (const file of starterFiles(botLanguage, templateName)) {
    const path = validateBotFilePath(file.path);
    const contentCiphertext = await sealBotFileContent(botId, file.content);
    await ctx.db.insert("botFiles", { botId, path, contentCiphertext });
  }
}

export async function deleteRowsForBot(ctx: MutationCtx, botId: Id<"bots">): Promise<void> {
  const files = await ctx.db
    .query("botFiles")
    .withIndex("by_bot_path", (q) => q.eq("botId", botId))
    .collect();
  for (const row of files) {
    await ctx.db.delete(row._id);
  }
  const logs = await ctx.db
    .query("botLogs")
    .withIndex("by_bot", (q) => q.eq("botId", botId))
    .collect();
  for (const row of logs) {
    await ctx.db.delete(row._id);
  }
}

/** Drops a (bot) user's member, channel-member and read-state rows; messages stay. */
export async function deleteRowsForUser(ctx: MutationCtx, userId: string): Promise<void> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of members) {
    await ctx.db.delete(row._id);
  }
  await adjustMemberCount(ctx, -members.length);
  const channelMembers = await ctx.db
    .query("channelMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of channelMembers) {
    await ctx.db.delete(row._id);
  }
  const readStates = await ctx.db
    .query("readStates")
    .withIndex("by_user_channel", (q) => q.eq("userId", userId))
    .collect();
  for (const row of readStates) {
    await ctx.db.delete(row._id);
  }
}

export interface FilePlan {
  readonly saved: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * Validates the final file set (count, per-file and total UTF-8 bytes), then
 * upserts and deletes rows. Existing sizes require opening untouched files
 * because `botFiles` stores no size column.
 */
export async function applyFileChanges(
  ctx: MutationCtx,
  botId: Id<"bots">,
  files: readonly { path: string; content: string }[],
  deletePaths: readonly string[],
): Promise<FilePlan> {
  const sizes = await currentFileSizes(ctx, botId);
  const saved = validateFileInputs(files);
  for (const file of saved) {
    sizes.set(file.path, file.bytes);
  }
  const deleted: string[] = [];
  for (const raw of deletePaths) {
    const path = validateBotFilePath(raw);
    if (sizes.delete(path)) {
      deleted.push(path);
    }
  }
  assertFileBudget(sizes);
  await writeFileChanges(ctx, botId, saved, deleted);
  return { saved: saved.map((file) => file.path), deleted };
}

/** Decoded UTF-8 sizes for a bot's stored files, used for the total-bytes cap. */
async function currentFileSizes(ctx: MutationCtx, botId: Id<"bots">): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query("botFiles")
    .withIndex("by_bot_path", (q) => q.eq("botId", botId))
    .collect();
  const sizes = new Map<string, number>();
  for (const row of rows) {
    sizes.set(row.path, botFileByteLength(await openBotFileContent(botId, row.contentCiphertext)));
  }
  return sizes;
}

/** Validates paths, uniqueness and per-file size; returns content with its size. */
function validateFileInputs(
  files: readonly { path: string; content: string }[],
): { path: string; content: string; bytes: number }[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const path = validateBotFilePath(file.path);
    if (seen.has(path)) {
      throw new ConvexError(`Duplicate file path: ${path}`);
    }
    seen.add(path);
    const bytes = botFileByteLength(file.content);
    if (bytes > BOT_LIMITS.maxFileBytes) {
      throw new ConvexError(`Each file must be at most ${BOT_LIMITS.maxFileBytes} bytes`);
    }
    return { path, content: file.content, bytes };
  });
}

/** Enforces the count and total-bytes caps over the final file set. */
function assertFileBudget(sizes: ReadonlyMap<string, number>): void {
  if (sizes.size > BOT_LIMITS.maxFiles) {
    throw new ConvexError(`A bot may have at most ${BOT_LIMITS.maxFiles} files`);
  }
  let total = 0;
  for (const bytes of sizes.values()) {
    total += bytes;
  }
  if (total > BOT_LIMITS.maxTotalBytes) {
    throw new ConvexError(`A bot's files may total at most ${BOT_LIMITS.maxTotalBytes} bytes`);
  }
}

/** Deletes removed rows, then seals and upserts the rest. */
async function writeFileChanges(
  ctx: MutationCtx,
  botId: Id<"bots">,
  saved: readonly { path: string; content: string }[],
  deleted: readonly string[],
): Promise<void> {
  for (const path of deleted) {
    const row = await ctx.db
      .query("botFiles")
      .withIndex("by_bot_path", (q) => q.eq("botId", botId).eq("path", path))
      .unique();
    if (row !== null) {
      await ctx.db.delete(row._id);
    }
  }
  for (const file of saved) {
    const contentCiphertext = await sealBotFileContent(botId, file.content);
    const row = await ctx.db
      .query("botFiles")
      .withIndex("by_bot_path", (q) => q.eq("botId", botId).eq("path", file.path))
      .unique();
    if (row === null) {
      await ctx.db.insert("botFiles", { botId, path: file.path, contentCiphertext });
    } else {
      await ctx.db.patch(row._id, { contentCiphertext });
    }
  }
}

export function clampLogLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LOG_LIMIT;
  }
  const rounded = Math.floor(limit);
  if (rounded < 1) {
    return DEFAULT_LOG_LIMIT;
  }
  return Math.min(rounded, BOT_LIMITS.maxLogLines);
}

/** Seals and replaces the whole env object, or clears it when empty. */
export async function sealEnvChanges(
  botId: Id<"bots">,
  values: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  return values.size === 0 ? undefined : await sealBotEnv(botId, values);
}
