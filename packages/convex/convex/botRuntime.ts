/**
 * Internal functions behind the runner HTTP endpoints (`botRunnerHttp.ts`).
 * The runner authenticates at the HTTP layer with `BOT_RUNNER_TOKEN`, so these
 * functions are internal-only and skip the `ManageBots` gate.
 *
 * Log lines are sealed before insert; credentials are returned as plaintext
 * once and only their SHA-256 hash is stored.
 */
import { BOT_ENTRY_FILES, BOT_LIMITS, type BotLanguage } from "@aulora/core";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { generateBotToken, hashBotToken } from "./lib/botAuth";
import { botLogContext, clipToBytes, openBotEnv, openBotFileContent } from "./lib/botFiles";
import { sealString } from "./lib/sse";

const MAX_STATUS_MESSAGE = 500;

const stream = v.union(v.literal("stdout"), v.literal("stderr"), v.literal("system"));
const status = v.union(
  v.literal("stopped"),
  v.literal("starting"),
  v.literal("running"),
  v.literal("crashed"),
);

interface DesiredBot {
  readonly botId: string;
  readonly userId: string;
  readonly name: string;
  readonly language: BotLanguage;
  readonly entry: string;
  readonly revision: number;
  readonly restartNonce: number;
}

interface BotBundle {
  readonly botId: string;
  readonly userId: string;
  readonly name: string;
  readonly language: BotLanguage;
  readonly entry: string;
  readonly revision: number;
  readonly files: readonly { path: string; content: string }[];
  readonly env: Record<string, string>;
}

/** Singleton heartbeat; created on first poll. */
async function touchRunner(ctx: MutationCtx): Promise<void> {
  const runner = await ctx.db.query("botRunner").first();
  if (runner === null) {
    await ctx.db.insert("botRunner", { lastSeenAt: Date.now() });
  } else {
    await ctx.db.patch(runner._id, { lastSeenAt: Date.now() });
  }
}

/** Enabled bots plus a heartbeat: the runner's 3 s reconcile poll. */
export const desired = internalMutation({
  args: {},
  handler: async (ctx): Promise<DesiredBot[]> => {
    await touchRunner(ctx);
    const bots = await ctx.db
      .query("bots")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    return bots.map((bot) => ({
      botId: bot._id,
      userId: bot.userId,
      name: bot.name,
      language: bot.language,
      entry: BOT_ENTRY_FILES[bot.language],
      revision: bot.revision,
      restartNonce: bot.restartNonce,
    }));
  },
});

/** Source, env (opened) and revision for a launch; `null` when unknown/disabled. */
export const bundle = internalQuery({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<BotBundle | null> => {
    const bot = await ctx.db.get(args.botId);
    if (bot === null || !bot.enabled) {
      return null;
    }
    const rows = await ctx.db
      .query("botFiles")
      .withIndex("by_bot_path", (q) => q.eq("botId", args.botId))
      .collect();
    const files = [];
    for (const row of rows) {
      files.push({
        path: row.path,
        content: await openBotFileContent(bot._id, row.contentCiphertext),
      });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    const env = Object.fromEntries(await openBotEnv(bot._id, bot.envCiphertext));
    return {
      botId: bot._id,
      userId: bot.userId,
      name: bot.name,
      language: bot.language,
      entry: BOT_ENTRY_FILES[bot.language],
      revision: bot.revision,
      files,
      env,
    };
  },
});

/** Mints a fresh runner-injected token, replacing any previous one. */
export const credential = internalMutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, args): Promise<{ token: string } | null> => {
    const bot = await ctx.db.get(args.botId);
    if (bot === null || !bot.enabled) {
      return null;
    }
    const token = generateBotToken();
    await ctx.db.patch(bot._id, { hostedTokenHash: await hashBotToken(token) });
    return { token };
  },
});

/** Records a runner status report; unknown bots return false. */
export const report = internalMutation({
  args: { botId: v.id("bots"), status, message: v.optional(v.string()) },
  handler: async (ctx, args): Promise<boolean> => {
    const bot = await ctx.db.get(args.botId);
    if (bot === null) {
      return false;
    }
    const message = args.message?.trim();
    await ctx.db.patch(bot._id, {
      status: args.status,
      statusAt: Date.now(),
      statusMessage:
        message !== undefined && message.length > 0
          ? message.slice(0, MAX_STATUS_MESSAGE)
          : undefined,
    });
    return true;
  },
});

/** Keeps only the newest `BOT_LIMITS.maxLogLines` rows for a bot. */
async function trimLogs(ctx: MutationCtx, botId: Id<"bots">): Promise<void> {
  const cap = BOT_LIMITS.maxLogLines;
  // Read only the newest `cap` rows. `by_bot` appends `_creationTime`, so
  // "desc" is newest-first; once we know the oldest row we keep, we can delete
  // just the older remainder instead of collecting the bot's whole log history.
  const newest = await ctx.db
    .query("botLogs")
    .withIndex("by_bot", (q) => q.eq("botId", botId))
    .order("desc")
    .take(cap);
  if (newest.length < cap) {
    return;
  }
  const oldestKept = newest[newest.length - 1];
  if (oldestKept === undefined) {
    return;
  }
  for (;;) {
    const overflow = await ctx.db
      .query("botLogs")
      .withIndex("by_bot", (q) =>
        q.eq("botId", botId).lt("_creationTime", oldestKept._creationTime),
      )
      .take(cap);
    for (const row of overflow) {
      await ctx.db.delete(row._id);
    }
    if (overflow.length < cap) {
      break;
    }
  }
}

/** Appends captured lines (sealed, clipped) and trims to the cap. */
export const appendLogs = internalMutation({
  args: {
    botId: v.id("bots"),
    lines: v.array(v.object({ stream, text: v.string(), at: v.number() })),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const bot = await ctx.db.get(args.botId);
    if (bot === null) {
      return false;
    }
    for (const line of args.lines) {
      await ctx.db.insert("botLogs", {
        botId: bot._id,
        stream: line.stream,
        textCiphertext: await sealString(
          botLogContext(bot._id),
          clipToBytes(line.text, BOT_LIMITS.maxLogLineBytes),
        ),
        at: line.at,
      });
    }
    await trimLogs(ctx, bot._id);
    return true;
  },
});
