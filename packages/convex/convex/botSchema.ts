import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Tables behind user-created bots, kept apart from `schema.ts` so that file
 * stays within the repo's size limit. Spread into `defineSchema` there. See
 * `docs/bots-design.md`.
 */
export const botTables = {
  /**
   * User-created bots. A bot acts like a member: it has a `members` row, a
   * `bot_<id>` user id (its JWT subject) and sends/reads/deletes through the
   * same functions as people. Unlike a member it does not inherit `@everyone`;
   * its permissions are exactly `grants` (default 0n), optionally narrowed to
   * `allowedChannelIds`. See `docs/bots-design.md`.
   */
  bots: defineTable({
    /** `bot_<_id>`; patched in right after insert. Also the JWT subject. */
    userId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    language: v.union(v.literal("typescript"), v.literal("python")),
    /** The runner only runs enabled bots; disabled bots cannot get a JWT. */
    enabled: v.boolean(),
    /** Workspace-level permission bits. Never contains `BOT_BLOCKED_PERMISSIONS`. */
    grants: v.int64(),
    /** Absent means every channel the grants reach; present narrows to this list. */
    allowedChannelIds: v.optional(v.array(v.id("channels"))),
    createdBy: v.string(),
    createdAt: v.number(),
    /** Bumped when files, env, language or enabled change; the runner reloads on change. */
    revision: v.number(),
    /** Bumped by "restart" so the runner relaunches an otherwise unchanged bot. */
    restartNonce: v.number(),
    /** SHA-256 hex of the externally usable API token (shown once). */
    tokenHash: v.optional(v.string()),
    tokenLast4: v.optional(v.string()),
    /** SHA-256 hex of the token the runner injects into the hosted process; rotated per launch. */
    hostedTokenHash: v.optional(v.string()),
    /** Server-sealed JSON object of environment variables for the hosted process. */
    envCiphertext: v.optional(v.string()),
    status: v.union(
      v.literal("stopped"),
      v.literal("starting"),
      v.literal("running"),
      v.literal("crashed"),
    ),
    statusMessage: v.optional(v.string()),
    statusAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_hosted_token_hash", ["hostedTokenHash"])
    .index("by_enabled", ["enabled"]),

  /** Source files of a hosted bot, sealed at rest. `path` is relative and validated. */
  botFiles: defineTable({
    botId: v.id("bots"),
    path: v.string(),
    contentCiphertext: v.string(),
  }).index("by_bot_path", ["botId", "path"]),

  /**
   * Short-lived outbox feeding `botEvents.poll`. Rows only carry ids; content is
   * read and opened at poll time so a bot never sees a message it cannot view.
   * Pruned by cron after one hour.
   */
  botEvents: defineTable({
    type: v.union(
      v.literal("message.created"),
      v.literal("message.updated"),
      v.literal("message.deleted"),
      v.literal("reaction.added"),
      v.literal("reaction.removed"),
    ),
    channelId: v.id("channels"),
    messageId: v.optional(v.id("messages")),
    /** Reaction events: who reacted. */
    userId: v.optional(v.string()),
    /** Reaction events: server-sealed emoji, same envelope as `reactions`. */
    emojiCiphertext: v.optional(v.string()),
  }),

  /** Captured stdout/stderr of hosted bots, sealed. Capped per bot. */
  botLogs: defineTable({
    botId: v.id("bots"),
    stream: v.union(v.literal("stdout"), v.literal("stderr"), v.literal("system")),
    textCiphertext: v.string(),
    at: v.number(),
  }).index("by_bot", ["botId"]),

  /** Singleton: when the bot-runner container last polled for work. */
  botRunner: defineTable({
    lastSeenAt: v.number(),
  }),
};
