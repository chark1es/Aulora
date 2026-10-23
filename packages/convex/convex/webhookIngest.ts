/**
 * The write path behind `POST /api/webhooks/<id>/<token>`. Internal only: the
 * HTTP action in `webhookHttp.ts` hashes the secret and calls this, so the
 * check, the rate limit and the insert are one transaction.
 */
import { WEBHOOK_RATE_LIMIT } from "@aulora/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { emitBotEvent } from "./lib/botEvents";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { sealString } from "./lib/sse";

/** `lastUsedAt` is rewritten at most this often. */
const LAST_USED_GRANULARITY_MS = 60_000;

export type WebhookPostResult =
  | { readonly status: "ok"; readonly messageId: string }
  | { readonly status: "not_found" | "rate_limited" | "channel_unavailable" };

export const post = internalMutation({
  args: { webhookId: v.string(), tokenHash: v.string(), content: v.string() },
  handler: async (ctx, args): Promise<WebhookPostResult> => {
    const webhook = await ctx.db
      .query("webhooks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    // The id in the URL must match too, so a leaked hash alone is no use.
    if (webhook === null || webhook.deletedAt !== undefined || webhook._id !== args.webhookId) {
      return { status: "not_found" };
    }
    const channel = await ctx.db.get(webhook.channelId);
    if (channel === null || channel.archived) {
      return { status: "channel_unavailable" };
    }
    try {
      await enforceRateLimit(ctx, {
        key: userRateLimitKey("webhook", webhook.userId),
        limit: WEBHOOK_RATE_LIMIT.limit,
        windowMs: WEBHOOK_RATE_LIMIT.windowMs,
      });
    } catch {
      return { status: "rate_limited" };
    }
    const ciphertext = await sealString(
      { scope: "message", recordId: webhook.channelId as string },
      args.content,
    );
    // No mention ids are stored: a webhook's text never notifies anyone by name.
    const messageId = await ctx.db.insert("messages", {
      channelId: webhook.channelId,
      authorId: webhook.userId,
      ciphertext,
      attachmentIds: [],
      mentionUserIds: [],
    });
    const now = Date.now();
    if (webhook.lastUsedAt === undefined || now - webhook.lastUsedAt >= LAST_USED_GRANULARITY_MS) {
      await ctx.db.patch(webhook._id, { lastUsedAt: now });
    }
    await emitBotEvent(ctx, {
      type: "message.created",
      channelId: webhook.channelId,
      messageId,
    });
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchForMessage, { messageId });
    return { status: "ok", messageId };
  },
});
