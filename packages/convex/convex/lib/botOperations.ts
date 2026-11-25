import { BOT_LIMITS, BOT_USER_ID_PREFIX, type BotLanguage } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { botLogContext, openBotEnv, validateBotEnvName, validateBotEnvValue } from "./botFiles";
import {
  applyFileChanges,
  assertNameFree,
  type BotDoc,
  clampLogLimit,
  RUNNER_ONLINE_MS,
  requireBot,
  requireCanControlBot,
  sealEnvChanges,
  seedStarterFiles,
  validateDescription,
  validateName,
} from "./botManagement";
import type { BotTemplateName } from "./botTemplates";
import type { BotLogLine, BotRunnerStatus, BotStatus } from "./botTypes";
import { adjustMemberCount } from "./memberCount";
import type { PermissionContext } from "./permissions";
import { openContent } from "./sealed";

/**
 * Bot operations shared by the admin UI (`bots.ts`) and the MCP server
 * (`botMcpInternal.ts`). Each takes an explicit actor so validation, limits,
 * revision bumps and audit rows are identical on both paths. Callers are
 * responsible for the `ManageBots` gate (and, for MCP, token scope).
 */

/** Who performs an operation; `via` is set for MCP-originated calls. */
export interface BotActor {
  readonly userId: string;
  readonly context: PermissionContext;
  readonly via?: { readonly tokenId: Id<"botMcpTokens"> };
}

/** Writes an audit row for the actor, tagging MCP-originated rows. */
export async function auditAsActor(
  ctx: MutationCtx,
  actor: BotActor,
  action: string,
  targetId: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const full = actor.via === undefined ? meta : { ...meta, via: "mcp", tokenId: actor.via.tokenId };
  await writeAudit(ctx, {
    actorId: actor.userId,
    action,
    targetId,
    ...(full !== undefined ? { meta: JSON.stringify(full) } : {}),
  });
}

/**
 * Fields `update` may patch. Optional entries carry `| undefined` because a
 * patch with `undefined` clears the column (`exactOptionalPropertyTypes`).
 */
interface BotPatch {
  name?: string;
  description?: string | undefined;
  language?: BotLanguage;
  enabled?: boolean;
  revision?: number;
  status?: BotStatus;
  statusAt?: number;
  statusMessage?: string | undefined;
  hostedTokenHash?: string | undefined;
}

/** The `update` arguments, widened so `exactOptionalPropertyTypes` is satisfied. */
export interface BotUpdateInput {
  name: string | undefined;
  description: string | null | undefined;
  language: BotLanguage | undefined;
  enabled: boolean | undefined;
}

export interface BotCreateInput {
  name: string;
  description: string | undefined;
  language: BotLanguage;
  template: BotTemplateName | undefined;
}

/** Builds the patch for `update`; returns the changed field names for the audit. */
async function planUpdate(
  ctx: MutationCtx,
  bot: BotDoc,
  input: BotUpdateInput,
): Promise<{ patch: BotPatch; changed: string[] }> {
  const patch: BotPatch = {};
  const changed: string[] = [];
  if (input.name !== undefined) {
    const name = validateName(input.name);
    if (name !== bot.name) {
      await assertNameFree(ctx, name, bot._id);
      patch.name = name;
      changed.push("name");
    }
  }
  if (input.description !== undefined) {
    const description =
      input.description === null ? undefined : validateDescription(input.description);
    if (description !== bot.description) {
      patch.description = description;
      changed.push("description");
    }
  }
  if (input.language !== undefined && input.language !== bot.language) {
    patch.language = input.language;
    patch.revision = bot.revision + 1;
    changed.push("language");
  }
  if (input.enabled !== undefined && input.enabled !== bot.enabled) {
    patch.enabled = input.enabled;
    patch.revision = bot.revision + 1;
    changed.push("enabled");
    if (!input.enabled) {
      // A disabled bot must lose the runner-injected credential immediately.
      patch.status = "stopped";
      patch.statusAt = Date.now();
      patch.statusMessage = undefined;
      patch.hostedTokenHash = undefined;
    }
  }
  return { patch, changed };
}

/** Creates a disabled bot with no permissions and starter files for the template. */
export async function createBotAs(
  ctx: MutationCtx,
  actor: BotActor,
  input: BotCreateInput,
): Promise<{ botId: Id<"bots"> }> {
  const name = validateName(input.name);
  await assertNameFree(ctx, name);
  if ((await ctx.db.query("bots").take(BOT_LIMITS.maxBots)).length >= BOT_LIMITS.maxBots) {
    throw new ConvexError(`This workspace may have at most ${BOT_LIMITS.maxBots} bots`);
  }
  const description =
    input.description === undefined ? undefined : validateDescription(input.description);
  const now = Date.now();
  const botId = await ctx.db.insert("bots", {
    // Patched to `bot_<id>` right after insert; the id is not known before.
    userId: `${BOT_USER_ID_PREFIX}pending`,
    name,
    ...(description !== undefined ? { description } : {}),
    language: input.language,
    enabled: false,
    grants: 0n,
    createdBy: actor.userId,
    createdAt: now,
    revision: 1,
    restartNonce: 0,
    status: "stopped",
    statusAt: now,
  });
  const botUserId = `${BOT_USER_ID_PREFIX}${botId}`;
  await ctx.db.patch(botId, { userId: botUserId });
  await ctx.db.insert("members", {
    userId: botUserId,
    nickname: name,
    roleIds: [],
    joinedAt: now,
  });
  await adjustMemberCount(ctx, 1);
  await seedStarterFiles(ctx, botId, input.language, input.template ?? "hello");
  await auditAsActor(ctx, actor, "bot.create", botId, { name, language: input.language });
  return { botId };
}

/** Applies the name/description/language/enabled changes in `input`. */
export async function updateBotAs(
  ctx: MutationCtx,
  actor: BotActor,
  bot: BotDoc,
  input: BotUpdateInput,
): Promise<void> {
  const { patch, changed } = await planUpdate(ctx, bot, input);
  if (changed.length === 0) {
    return;
  }
  await ctx.db.patch(bot._id, patch);
  if (patch.name !== undefined) {
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", bot.userId))
      .unique();
    if (member !== null) {
      await ctx.db.patch(member._id, { nickname: patch.name });
    }
  }
  await auditAsActor(ctx, actor, "bot.update", bot._id, { changed });
}

/** Upserts `files` and deletes `deletePaths`, then bumps the bot's revision. */
export async function saveBotFilesAs(
  ctx: MutationCtx,
  actor: BotActor,
  botId: Id<"bots">,
  files: readonly { path: string; content: string }[],
  deletePaths: readonly string[],
): Promise<void> {
  const bot = await requireBot(ctx, botId);
  requireCanControlBot(actor.context, bot);
  const plan = await applyFileChanges(ctx, bot._id, files, deletePaths);
  await ctx.db.patch(bot._id, { revision: bot.revision + 1 });
  await auditAsActor(ctx, actor, "bot.files", bot._id, {
    saved: plan.saved,
    deleted: plan.deleted,
  });
}

/** Sets and removes environment variables. Values are sealed and write-only. */
export async function setBotEnvAs(
  ctx: MutationCtx,
  actor: BotActor,
  botId: Id<"bots">,
  entries: readonly { name: string; value: string }[],
  remove: readonly string[],
): Promise<void> {
  const bot = await requireBot(ctx, botId);
  requireCanControlBot(actor.context, bot);
  const values = await openBotEnv(bot._id, bot.envCiphertext);
  const removed: string[] = [];
  for (const raw of remove) {
    const name = validateBotEnvName(raw);
    if (values.delete(name)) {
      removed.push(name);
    }
  }
  const set: string[] = [];
  for (const entry of entries) {
    const name = validateBotEnvName(entry.name);
    values.set(name, validateBotEnvValue(entry.value));
    set.push(name);
  }
  if (values.size > BOT_LIMITS.maxEnvVars) {
    throw new ConvexError(`A bot may have at most ${BOT_LIMITS.maxEnvVars} environment variables`);
  }
  await ctx.db.patch(bot._id, {
    envCiphertext: await sealEnvChanges(bot._id, values),
    revision: bot.revision + 1,
  });
  await auditAsActor(ctx, actor, "bot.env", bot._id, { set, removed });
}

/** Asks the runner to relaunch the bot. Only MCP-originated restarts are audited. */
export async function restartBotAs(ctx: MutationCtx, actor: BotActor, bot: BotDoc): Promise<void> {
  await ctx.db.patch(bot._id, { restartNonce: bot.restartNonce + 1 });
  if (actor.via !== undefined) {
    await auditAsActor(ctx, actor, "bot.restart", bot._id);
  }
}

/** The newest `limit` retained log lines (oldest first), opened for display. */
export async function readBotLogs(
  ctx: QueryCtx | MutationCtx,
  botId: Id<"bots">,
  limit: number | undefined,
): Promise<BotLogLine[]> {
  const rows = await ctx.db
    .query("botLogs")
    .withIndex("by_bot", (q) => q.eq("botId", botId))
    .order("desc")
    .take(clampLogLimit(limit));
  rows.sort((left, right) => left.at - right.at);
  const lines: BotLogLine[] = [];
  for (const row of rows) {
    lines.push({
      stream: row.stream,
      text: await openContent(botLogContext(botId), row.textCiphertext),
      at: row.at,
    });
  }
  return lines;
}

/** Whether the runner container polled recently. */
export async function readRunnerStatus(ctx: QueryCtx | MutationCtx): Promise<BotRunnerStatus> {
  const runner = await ctx.db.query("botRunner").first();
  const lastSeenAt = runner?.lastSeenAt ?? null;
  return {
    online: lastSeenAt !== null && Date.now() - lastSeenAt < RUNNER_ONLINE_MS,
    lastSeenAt,
  };
}
