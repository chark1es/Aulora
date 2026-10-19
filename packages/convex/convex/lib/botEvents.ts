/**
 * Appends rows to `botEvents` from message and reaction mutations. `poll`
 * reads and filters them; the table is pruned hourly. See `docs/bots-design.md`.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { BotEventType } from "./botTypes";

export interface BotEventInput {
  readonly type: BotEventType;
  readonly channelId: Id<"channels">;
  /** Message events: the affected message. */
  readonly messageId?: Id<"messages">;
  /** Reaction events: who reacted. */
  readonly userId?: string;
  /** Reaction events: the sealed emoji exactly as stored on `reactions`. */
  readonly emojiCiphertext?: string;
}

/**
 * Records one event for bots to pick up. A no-op unless at least one bot is
 * enabled (a single indexed read), so workspaces without bots pay almost nothing.
 */
export async function emitBotEvent(ctx: MutationCtx, event: BotEventInput): Promise<void> {
  const enabled = await ctx.db
    .query("bots")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .first();
  if (enabled === null) {
    return;
  }
  await ctx.db.insert("botEvents", {
    type: event.type,
    channelId: event.channelId,
    ...(event.messageId !== undefined ? { messageId: event.messageId } : {}),
    ...(event.userId !== undefined ? { userId: event.userId } : {}),
    ...(event.emojiCiphertext !== undefined ? { emojiCiphertext: event.emojiCiphertext } : {}),
  });
}
