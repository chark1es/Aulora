/**
 * Bot management API used by the web admin UI (Workspace settings -> Bots).
 * Every function requires `Permission.ManageBots`. The shapes are the contract
 * in `lib/botTypes.ts`; see `docs/bots-design.md`.
 *
 * Secrets never leave the server: only token hashes and env names are stored or
 * returned, source and env values are sealed at rest, and audit rows carry
 * names/ids only.
 */
import { isValidBotGrant, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { botTokenLast4, generateBotToken, hashBotToken } from "./lib/botAuth";
import {
  deleteRowsForBot,
  deleteRowsForUser,
  requireBot,
  requireCanControlBot,
  toDetail,
  toSummary,
} from "./lib/botManagement";
import {
  createBotAs,
  readBotLogs,
  readRunnerStatus,
  restartBotAs,
  saveBotFilesAs,
  setBotEnvAs,
  updateBotAs,
} from "./lib/botOperations";
import type { BotDetail, BotLogLine, BotRunnerStatus, BotSummary } from "./lib/botTypes";
import { requireCanGrant, requireWorkspaceContext } from "./lib/permissions";

const language = v.union(v.literal("typescript"), v.literal("python"));
const template = v.union(v.literal("hello"), v.literal("blank"));

export const list = query({
  args: {},
  handler: async (ctx): Promise<BotSummary[]> => {
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    return (await ctx.db.query("bots").collect()).map(toSummary);
  },
});

export const get = query({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<BotDetail | null> => {
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await ctx.db.get(args.botId);
    return bot === null ? null : await toDetail(ctx, bot);
  },
});

/** Creates a disabled bot with no permissions and starter files for `template`. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    language,
    template: v.optional(template),
  },
  handler: async (ctx, args): Promise<{ botId: string }> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    return await createBotAs(
      ctx,
      { userId, context },
      {
        name: args.name,
        description: args.description,
        language: args.language,
        template: args.template,
      },
    );
  },
});

export const update = mutation({
  args: {
    botId: v.id("bots"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    language: v.optional(language),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<null> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    await updateBotAs(ctx, { userId, context }, bot, {
      name: args.name,
      description: args.description,
      language: args.language,
      enabled: args.enabled,
    });
    return null;
  },
});

/** Replaces the bot's grants and channel scope. `allowedChannelIds: null` = all channels. */
export const setPermissions = mutation({
  args: {
    botId: v.id("bots"),
    grants: v.int64(),
    allowedChannelIds: v.union(v.array(v.id("channels")), v.null()),
  },
  handler: async (ctx, args): Promise<null> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    if (!isValidBotGrant(args.grants)) {
      throw new ConvexError("That permission cannot be granted to a bot");
    }
    requireCanGrant(context, args.grants);
    if (args.allowedChannelIds !== null) {
      for (const channelId of args.allowedChannelIds) {
        if ((await ctx.db.get(channelId)) === null) {
          throw new ConvexError("Unknown channel in the bot's scope");
        }
      }
    }
    await ctx.db.patch(bot._id, {
      grants: args.grants,
      allowedChannelIds: args.allowedChannelIds === null ? undefined : args.allowedChannelIds,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.permissions",
      targetId: bot._id,
      meta: JSON.stringify({
        grants: args.grants.toString(),
        channels: args.allowedChannelIds === null ? "all" : args.allowedChannelIds.length,
      }),
    });
    return null;
  },
});

/** Upserts `files` and deletes `deletePaths`, then bumps the bot's revision. */
export const saveFiles = mutation({
  args: {
    botId: v.id("bots"),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
    deletePaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<null> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    await saveBotFilesAs(ctx, { userId, context }, args.botId, args.files, args.deletePaths ?? []);
    return null;
  },
});

/** Sets and removes environment variables. Values are sealed and write-only. */
export const setEnv = mutation({
  args: {
    botId: v.id("bots"),
    set: v.array(v.object({ name: v.string(), value: v.string() })),
    remove: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    await setBotEnvAs(ctx, { userId, context }, args.botId, args.set, args.remove);
    return null;
  },
});

/** Issues a new external API token (replacing any old one). Returned once. */
export const rotateToken = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    requireCanControlBot(context, bot);
    const token = generateBotToken();
    await ctx.db.patch(bot._id, {
      tokenHash: await hashBotToken(token),
      tokenLast4: botTokenLast4(token),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.token.rotate",
      targetId: bot._id,
    });
    return { token };
  },
});

export const revokeToken = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    await ctx.db.patch(bot._id, { tokenHash: undefined, tokenLast4: undefined });
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.token.revoke",
      targetId: bot._id,
    });
    return null;
  },
});

/** Asks the runner to relaunch the bot. */
export const restart = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<null> => {
    const { userId, context } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    await restartBotAs(ctx, { userId, context }, bot);
    return null;
  },
});

export const remove = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    await deleteRowsForUser(ctx, bot.userId);
    await deleteRowsForBot(ctx, bot._id);
    await ctx.db.delete(bot._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.delete",
      targetId: bot._id,
      meta: JSON.stringify({ name: bot.name }),
    });
    return null;
  },
});

export const logs = query({
  args: { botId: v.id("bots"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BotLogLine[]> => {
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await ctx.db.get(args.botId);
    if (bot === null) {
      return [];
    }
    return await readBotLogs(ctx, args.botId, args.limit);
  },
});

export const runnerStatus = query({
  args: {},
  handler: async (ctx): Promise<BotRunnerStatus> => {
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    return await readRunnerStatus(ctx);
  },
});
