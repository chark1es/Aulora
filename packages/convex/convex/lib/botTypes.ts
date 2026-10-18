import type { BotLanguage } from "@aulora/core";
import type { Id } from "../_generated/dataModel";

export type BotStatus = "stopped" | "starting" | "running" | "crashed";

/** One bot as shown in the Bots admin list. Secrets are never included. */
export interface BotSummary {
  readonly id: Id<"bots">;
  /** `bot_<id>`: the bot's user id and the `authorId` on its messages. */
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly language: BotLanguage;
  readonly enabled: boolean;
  /** Workspace-level permission bits. A new bot has none. */
  readonly grants: bigint;
  /** `null` means every channel the grants reach. */
  readonly allowedChannelIds: readonly Id<"channels">[] | null;
  readonly status: BotStatus;
  readonly statusMessage: string | null;
  readonly statusAt: number;
  /** Whether an external API token exists (the token itself is shown once). */
  readonly hasToken: boolean;
  readonly tokenLast4: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly revision: number;
}

export interface BotFileView {
  readonly path: string;
  readonly content: string;
}

export type BotDetail = BotSummary & {
  readonly files: readonly BotFileView[];
  /** Environment variable names only; values are write-only. */
  readonly envNames: readonly string[];
};

export interface BotLogLine {
  readonly stream: "stdout" | "stderr" | "system";
  readonly text: string;
  readonly at: number;
}

export interface BotRunnerStatus {
  /** True when the runner container polled within the last 30 seconds. */
  readonly online: boolean;
  readonly lastSeenAt: number | null;
}

export type BotEventType =
  | "message.created"
  | "message.updated"
  | "message.deleted"
  | "reaction.added"
  | "reaction.removed";

export interface BotEventMessage {
  readonly id: Id<"messages">;
  readonly channelId: Id<"channels">;
  readonly authorId: string;
  readonly body: string;
  readonly threadRootId: Id<"messages"> | null;
  readonly replyToId: Id<"messages"> | null;
  readonly attachmentIds: readonly Id<"files">[];
  readonly mentionUserIds: readonly string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly createdAt: number;
}

export interface BotEventReaction {
  readonly messageId: Id<"messages">;
  readonly userId: string;
  readonly emoji: string;
}

export interface BotEvent {
  /** The event row's `_creationTime`; strictly increasing, usable as a cursor. */
  readonly seq: number;
  readonly type: BotEventType;
  readonly channelId: Id<"channels">;
  /** Present for message.* events; `body` is empty for message.deleted. */
  readonly message: BotEventMessage | null;
  /** Present for reaction.* events. */
  readonly reaction: BotEventReaction | null;
  /** True when this bot performed the action. SDKs hide these by default. */
  readonly self: boolean;
}

export interface BotPollResult {
  readonly events: readonly BotEvent[];
  /** Pass back as `cursor`. A `null` cursor on the first call starts at "now". */
  readonly cursor: number;
  readonly me: { readonly userId: string; readonly name: string };
}
