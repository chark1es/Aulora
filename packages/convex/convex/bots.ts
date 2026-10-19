/**
 * Bot management API used by the web admin UI (Workspace settings -> Bots).
 * Every function requires `Permission.ManageBots`. The shapes are the contract
 * in `lib/botTypes.ts`; see `docs/bots-design.md`.
 *
 * Secrets never leave the server: only token hashes and env names are stored or
 * returned, source and env values are sealed at rest, and audit rows carry
 * names/ids only.
 */
import {
  BOT_LIMITS,
  BOT_USER_ID_PREFIX,
  type BotLanguage,
  isValidBotGrant,
  Permission,
} from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { botTokenLast4, generateBotToken, hashBotToken } from "./lib/botAuth";
import { botLogContext, openBotEnv, validateBotEnvName, validateBotEnvValue } from "./lib/botFiles";
import {
  applyFileChanges,
  assertNameFree,
  type BotDoc,
  clampLogLimit,
  deleteRowsForBot,
  deleteRowsForUser,
  RUNNER_ONLINE_MS,
  requireBot,
  requireCanControlBot,
  sealEnvChanges,
  seedStarterFiles,
  toDetail,
  toSummary,
  validateDescription,
  validateName,
} from "./lib/botManagement";
import type { BotDetail, BotLogLine, BotRunnerStatus, BotStatus, BotSummary } from "./lib/botTypes";
import { adjustMemberCount } from "./lib/memberCount";
import { requireCanGrant, requireWorkspaceContext } from "./lib/permissions";
import { openContent } from "./lib/sealed";

const language = v.union(v.literal("typescript"), v.literal("python"));
const template = v.union(v.literal("hello"), v.literal("blank"));

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
  restartNonce?: number;
  grants?: bigint;
  allowedChannelIds?: Id<"channels">[] | undefined;
  envCiphertext?: string | undefined;
  tokenHash?: string | undefined;
  tokenLast4?: string | undefined;
}

/** The `update` arguments, widened so `exactOptionalPropertyTypes` is satisfied. */
interface UpdateInput {
  name: string | undefined;
  description: string | null | undefined;
  /** Validated by the `update` args to be one of the bot languages. */
  language: string | undefined;
  enabled: boolean | undefined;
}

/** Builds the patch for `update`; returns the changed field names for the audit. */
async function planUpdate(
  ctx: MutationCtx,
  bot: BotDoc,
  input: UpdateInput,
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
    patch.language = input.language as BotLanguage;
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
    const { userId } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const name = validateName(args.name);
    await assertNameFree(ctx, name);
    if ((await ctx.db.query("bots").collect()).length >= BOT_LIMITS.maxBots) {
      throw new ConvexError(`This workspace may have at most ${BOT_LIMITS.maxBots} bots`);
    }
    const description =
      args.description === undefined ? undefined : validateDescription(args.description);
    const now = Date.now();
    const botId = await ctx.db.insert("bots", {
      // Patched to `bot_<id>` right after insert; the id is not known before.
      userId: `${BOT_USER_ID_PREFIX}pending`,
      name,
      ...(description !== undefined ? { description } : {}),
      language: args.language,
      enabled: false,
      grants: 0n,
      createdBy: userId,
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
    await seedStarterFiles(ctx, botId, args.language, args.template ?? "hello");
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.create",
      targetId: botId,
      meta: JSON.stringify({ name, language: args.language }),
    });
    return { botId };
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
    const { userId } = await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    const { patch, changed } = await planUpdate(ctx, bot, {
      name: args.name,
      description: args.description,
      language: args.language,
      enabled: args.enabled,
    });
    if (changed.length === 0) {
      return null;
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
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.update",
      targetId: bot._id,
      meta: JSON.stringify({ changed }),
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
    const bot = await requireBot(ctx, args.botId);
    requireCanControlBot(context, bot);
    const plan = await applyFileChanges(ctx, bot._id, args.files, args.deletePaths ?? []);
    await ctx.db.patch(bot._id, { revision: bot.revision + 1 });
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.files",
      targetId: bot._id,
      meta: JSON.stringify({ saved: plan.saved, deleted: plan.deleted }),
    });
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
    const bot = await requireBot(ctx, args.botId);
    requireCanControlBot(context, bot);
    const values = await openBotEnv(bot._id, bot.envCiphertext);
    const removed: string[] = [];
    for (const raw of args.remove) {
      const name = validateBotEnvName(raw);
      if (values.delete(name)) {
        removed.push(name);
      }
    }
    const set: string[] = [];
    for (const entry of args.set) {
      const name = validateBotEnvName(entry.name);
      values.set(name, validateBotEnvValue(entry.value));
      set.push(name);
    }
    if (values.size > BOT_LIMITS.maxEnvVars) {
      throw new ConvexError(
        `A bot may have at most ${BOT_LIMITS.maxEnvVars} environment variables`,
      );
    }
    await ctx.db.patch(bot._id, {
      envCiphertext: await sealEnvChanges(bot._id, values),
      revision: bot.revision + 1,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "bot.env",
      targetId: bot._id,
      meta: JSON.stringify({ set, removed }),
    });
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
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    const bot = await requireBot(ctx, args.botId);
    await ctx.db.patch(bot._id, { restartNonce: bot.restartNonce + 1 });
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
    const rows = await ctx.db
      .query("botLogs")
      .withIndex("by_bot", (q) => q.eq("botId", args.botId))
      .collect();
    rows.sort((left, right) => left.at - right.at);
    const lines: BotLogLine[] = [];
    for (const row of rows.slice(-clampLogLimit(args.limit))) {
      lines.push({
        stream: row.stream,
        text: await openContent(botLogContext(args.botId), row.textCiphertext),
        at: row.at,
      });
    }
    return lines;
  },
});

export const runnerStatus = query({
  args: {},
  handler: async (ctx): Promise<BotRunnerStatus> => {
    await requireWorkspaceContext(ctx, Permission.ManageBots);
    const runner = await ctx.db.query("botRunner").first();
    const lastSeenAt = runner?.lastSeenAt ?? null;
    return {
      online: lastSeenAt !== null && Date.now() - lastSeenAt < RUNNER_ONLINE_MS,
      lastSeenAt,
    };
  },
});
