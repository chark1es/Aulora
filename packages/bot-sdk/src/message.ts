import type { BotIdentity } from "./config.js";

/** The fields every message has, whether it came from `messages:list` or an event. */
export interface MessageData {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly body: string;
  readonly threadRootId: string | null;
  readonly replyToId: string | null;
  readonly mentionUserIds: readonly string[];
  readonly createdAt: number;
  readonly editedAt?: number | null;
  readonly deletedAt?: number | null;
}

export interface SendMessageOptions {
  readonly replyToId?: string;
  readonly threadRootId?: string;
}

/** The slice of the bot a message needs to expose its helpers. */
export interface MessageActions {
  me(): BotIdentity | null;
  send(channelId: string, body: string, options?: SendMessageOptions): Promise<Message>;
  edit(messageId: string, body: string): Promise<void>;
  delete(messageId: string): Promise<void>;
  react(messageId: string, emoji: string): Promise<void>;
}

/**
 * A message snapshot with reply/react/edit/delete helpers bound to the bot that
 * received it. `mentionsMe` uses the identity from the latest token exchange.
 */
export class Message {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly threadRootId: string | null;
  readonly replyToId: string | null;
  readonly mentionUserIds: readonly string[];
  readonly createdAt: number;
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  body: string;
  private readonly actions: MessageActions;

  constructor(data: MessageData, actions: MessageActions) {
    this.id = data.id;
    this.channelId = data.channelId;
    this.authorId = data.authorId;
    this.body = data.body;
    this.threadRootId = data.threadRootId;
    this.replyToId = data.replyToId;
    this.mentionUserIds = data.mentionUserIds;
    this.createdAt = data.createdAt;
    this.editedAt = data.editedAt ?? null;
    this.deletedAt = data.deletedAt ?? null;
    this.actions = actions;
  }

  /** True when this message mentions the bot's own user id. */
  get mentionsMe(): boolean {
    const me = this.actions.me();
    return me !== null && this.mentionUserIds.includes(me.userId);
  }

  /** Sends a reply, staying inside the same thread when this is a thread reply. */
  async reply(body: string): Promise<Message> {
    return await this.actions.send(this.channelId, body, {
      replyToId: this.id,
      ...(this.threadRootId !== null ? { threadRootId: this.threadRootId } : {}),
    });
  }

  /** Adds a reaction to this message. */
  async react(emoji: string): Promise<void> {
    await this.actions.react(this.id, emoji);
  }

  /** Deletes this message (the author or a manager may do this). */
  async delete(): Promise<void> {
    await this.actions.delete(this.id);
  }

  /** Edits this message and updates the local snapshot on success. */
  async edit(body: string): Promise<void> {
    await this.actions.edit(this.id, body);
    this.body = body;
  }
}
