import type { MessageData } from "./message.js";

export type BotEventType =
  | "message.created"
  | "message.updated"
  | "message.deleted"
  | "reaction.added"
  | "reaction.removed";

export interface BotEventMessage extends MessageData {
  readonly attachmentIds: readonly string[];
}

export interface BotEventReaction {
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: string;
}

/** One row of `botEvents:poll`; `seq` doubles as the next cursor. */
export interface BotEvent {
  readonly seq: number;
  readonly type: BotEventType;
  readonly channelId: string;
  readonly message: BotEventMessage | null;
  readonly reaction: BotEventReaction | null;
  /** True when this bot performed the action; hidden unless `includeSelf` is set. */
  readonly self: boolean;
}

export interface BotPollResult {
  readonly events: readonly BotEvent[];
  readonly cursor: number;
  readonly me: { readonly userId: string; readonly name: string };
}

/** Payload of the `reactionAdd` / `reactionRemove` events. */
export interface ReactionEvent {
  readonly messageId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly emoji: string;
  readonly self: boolean;
}

export interface ChannelOverride {
  readonly targetId: string;
  readonly targetType: "role" | "member";
  readonly allow: bigint;
  readonly deny: bigint;
}

/** A channel visible to the bot (`channels:list` rows). */
export interface Channel {
  readonly id: string;
  readonly kind: string;
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly topic: string | null;
  readonly archived: boolean;
  readonly isPrivate: boolean;
  readonly overrides: readonly ChannelOverride[];
  readonly position: number;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly pinned: boolean;
  readonly pinnedAt: number | null;
  readonly memberIds?: readonly string[];
}

/** A workspace member (`members:list` rows). */
export interface Member {
  readonly id: string;
  readonly userId: string;
  readonly nickname: string | null;
  readonly accountName: string | null;
  readonly roleIds: readonly string[];
  readonly joinedAt: number;
  readonly timeoutUntil: number | null;
  readonly avatarUrl: string | null;
  readonly isBot: boolean;
}

export interface Paginated<T> {
  readonly page: readonly T[];
  readonly isDone: boolean;
  readonly continueCursor: string | null;
}
