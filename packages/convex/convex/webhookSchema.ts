import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Incoming webhooks: a secret URL that posts messages into one channel.
 * Spread into `defineSchema` in `schema.ts`.
 */
export const webhookTables = {
  webhooks: defineTable({
    /** `webhook_<_id>`, patched in right after insert. Becomes `messages.authorId`. */
    userId: v.string(),
    channelId: v.id("channels"),
    name: v.string(),
    /** SHA-256 hex of the secret in the URL (shown once). Cleared on delete. */
    tokenHash: v.optional(v.string()),
    tokenLast4: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    /** Throttled to once a minute so a busy webhook does not rewrite its row per message. */
    lastUsedAt: v.optional(v.number()),
    /**
     * Set when an admin deletes the webhook. The row stays so the messages it
     * posted keep their author name; the secret is gone, so it cannot post.
     */
    deletedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"])
    .index("by_token_hash", ["tokenHash"]),
};
