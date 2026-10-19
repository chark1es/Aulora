/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type CallArgs, ConvexClient } from "./client.js";
import {
  type BotIdentity,
  type BotOptions,
  type ResolvedBotConfig,
  resolveBotConfig,
} from "./config.js";
import { TypedEmitter } from "./emitter.js";
import { AuloraError, toError } from "./errors.js";
import {
  Message,
  type MessageActions,
  type MessageData,
  type SendMessageOptions,
} from "./message.js";
import { EventPoller } from "./poller.js";
import { TokenManager } from "./token.js";
import type {
  BotEvent,
  BotEventMessage,
  BotPollResult,
  Channel,
  Member,
  Paginated,
  ReactionEvent,
} from "./types.js";
import type { CallKind } from "./urls.js";

/** Payload type for every event `bot.on` accepts. */
export interface BotEvents {
  /** Emitted once, after the first successful poll identifies the bot. */
  ready: BotIdentity;
  message: Message;
  messageUpdate: Message;
  messageDelete: Message;
  reactionAdd: ReactionEvent;
  reactionRemove: ReactionEvent;
  /** Handler failures and polling/transport failures. */
  error: Error;
}

export type BotEventName = keyof BotEvents;
export type BotHandler<K extends BotEventName> = (payload: BotEvents[K]) => void | Promise<void>;

export interface ListMessagesOptions {
  readonly limit?: number;
}

export interface ChannelsApi {
  /** Every channel the bot may see, walking all pages. */
  list(): Promise<Channel[]>;
}

export interface MessagesApi {
  list(channelId: string, options?: ListMessagesOptions): Promise<Message[]>;
  send(channelId: string, body: string, options?: SendMessageOptions): Promise<Message>;
  edit(messageId: string, body: string): Promise<void>;
  delete(messageId: string): Promise<void>;
}

export interface ReactionsApi {
  add(messageId: string, emoji: string): Promise<void>;
  remove(messageId: string, emoji: string): Promise<void>;
}

export interface MembersApi {
  list(): Promise<Member[]>;
}

interface ToggleResult {
  readonly added?: boolean;
}

const MAX_CHANNEL_PAGES = 20;
const DEFAULT_MESSAGE_LIMIT = 50;
const CHANNEL_PAGE_SIZE = 100;
const ERROR_BACKOFF_MS = 5000;

/**
 * A bot connection. It exchanges its API token for a JWT, polls the event feed,
 * and exposes the same Convex functions a member uses as typed helpers.
 *
 * ```ts
 * const bot = new Bot();
 * bot.on("message", async (message) => {
 *   if (message.body === "!ping") await message.reply("pong");
 * });
 * await bot.start();
 * ```
 */
export class Bot {
  private readonly config: ResolvedBotConfig;
  private readonly client: ConvexClient;
  private readonly emitter: TypedEmitter<BotEvents>;
  private readonly poller: EventPoller;
  private readonly actions: MessageActions;
  private readonly signalHandler = (): void => {
    void this.stop();
  };
  private polledIdentity: BotIdentity | null = null;
  private readyEmitted = false;
  private stopped = false;
  private reportingError = false;
  private resolveStart: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;

  readonly channels: ChannelsApi;
  readonly messages: MessagesApi;
  readonly reactions: ReactionsApi;
  readonly members: MembersApi;

  constructor(options: BotOptions = {}) {
    this.config = resolveBotConfig(options);
    const tokens = new TokenManager(this.config);
    this.client = new ConvexClient(this.config, tokens);
    this.emitter = new TypedEmitter<BotEvents>((error) => {
      this.emitError(error);
    });
    this.actions = this.createActions();
    this.poller = new EventPoller({
      intervalMs: this.config.pollIntervalMs,
      backoffMs: ERROR_BACKOFF_MS,
      poll: async (cursor, signal) => await this.poll(cursor, signal),
      onResult: (result) => {
        this.handlePoll(result);
      },
      onError: (error) => {
        this.emitError(error);
      },
    });
    this.channels = { list: async () => await this.listChannels() };
    this.messages = this.createMessagesApi();
    this.reactions = this.createReactionsApi();
    this.members = { list: async () => await this.listMembers() };
  }

  private createActions(): MessageActions {
    return {
      me: () => this.me,
      send: async (channelId, body, options) => await this.sendMessage(channelId, body, options),
      edit: async (messageId, body) => {
        await this.editMessage(messageId, body);
      },
      delete: async (messageId) => {
        await this.deleteMessage(messageId);
      },
      react: async (messageId, emoji) => {
        await this.addReaction(messageId, emoji);
      },
    };
  }

  private createMessagesApi(): MessagesApi {
    return {
      list: async (channelId, options) => await this.listMessages(channelId, options),
      send: async (channelId, body, options) => await this.sendMessage(channelId, body, options),
      edit: async (messageId, body) => {
        await this.editMessage(messageId, body);
      },
      delete: async (messageId) => {
        await this.deleteMessage(messageId);
      },
    };
  }

  private createReactionsApi(): ReactionsApi {
    return {
      add: async (messageId, emoji) => {
        await this.addReaction(messageId, emoji);
      },
      remove: async (messageId, emoji) => {
        await this.removeReaction(messageId, emoji);
      },
    };
  }

  /** The bot's identity once known (from the token exchange or first poll). */
  get me(): BotIdentity | null {
    return this.polledIdentity ?? this.client.identity;
  }

  /** Subscribes to one event. Returns an unsubscribe function. */
  on<K extends BotEventName>(event: K, handler: BotHandler<K>): this {
    this.emitter.on(event, handler);
    return this;
  }

  /** Unsubscribes a previously registered handler. */
  off<K extends BotEventName>(event: K, handler: BotHandler<K>): this {
    this.emitter.off(event, handler);
    return this;
  }

  /** Runs until {@link stop} is called or SIGTERM/SIGINT arrives. */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new AuloraError("This bot has already been stopped", { code: "bot_stopped" });
    }
    const existingStart = this.startPromise;
    if (existingStart !== null) {
      await existingStart;
      return;
    }
    const started = new Promise<void>((resolve) => {
      this.resolveStart = resolve;
    });
    this.startPromise = started;
    if (this.config.handleSignals) {
      process.on("SIGTERM", this.signalHandler);
      process.on("SIGINT", this.signalHandler);
    }
    this.poller.start();
    await started;
  }

  /** Stops polling and releases signal handlers and timers. */
  stop(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    this.stopped = true;
    process.off("SIGTERM", this.signalHandler);
    process.off("SIGINT", this.signalHandler);
    this.poller.stop();
    this.resolveStart?.();
    this.resolveStart = null;
    return Promise.resolve();
  }

  /** Escape hatch for any Convex function not wrapped by this SDK. */
  async call<T = unknown>(path: string, args: CallArgs = {}, kind: CallKind = "query"): Promise<T> {
    return await this.client.call<T>(path, args, kind);
  }

  private async poll(cursor: number | null, signal: AbortSignal): Promise<BotPollResult> {
    return await this.client.call<BotPollResult>(
      "botEvents:poll",
      { cursor, limit: 100 },
      "query",
      signal,
    );
  }

  private async listChannels(): Promise<Channel[]> {
    const channels: Channel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      const result: Paginated<Channel> = await this.client.call<Paginated<Channel>>(
        "channels:list",
        { paginationOpts: { numItems: CHANNEL_PAGE_SIZE, cursor } },
      );
      channels.push(...result.page);
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
    return channels;
  }

  private async listMessages(channelId: string, options?: ListMessagesOptions): Promise<Message[]> {
    const result = await this.client.call<Paginated<MessageData>>("messages:list", {
      channelId,
      paginationOpts: { numItems: options?.limit ?? DEFAULT_MESSAGE_LIMIT, cursor: null },
    });
    return result.page.map((data) => new Message(data, this.actions));
  }

  private async sendMessage(
    channelId: string,
    body: string,
    options?: SendMessageOptions,
  ): Promise<Message> {
    const args = {
      channelId,
      body,
      ...(options?.replyToId !== undefined ? { replyToId: options.replyToId } : {}),
      ...(options?.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
    };
    const id = await this.client.call<string>("messages:send", args, "mutation");
    return new Message(
      {
        id,
        channelId,
        authorId: this.me?.userId ?? "",
        body,
        threadRootId: options?.threadRootId ?? null,
        replyToId: options?.replyToId ?? null,
        mentionUserIds: [],
        createdAt: Date.now(),
      },
      this.actions,
    );
  }

  private async editMessage(messageId: string, body: string): Promise<void> {
    await this.client.call("messages:edit", { messageId, body }, "mutation");
  }

  private async deleteMessage(messageId: string): Promise<void> {
    await this.client.call("messages:remove", { messageId }, "mutation");
  }

  private async addReaction(messageId: string, emoji: string): Promise<void> {
    const result = await this.client.call<ToggleResult | null>(
      "reactions:toggle",
      { messageId, emoji },
      "mutation",
    );
    if (result !== null && result.added === false) {
      await this.client.call("reactions:toggle", { messageId, emoji }, "mutation");
    }
  }

  private async removeReaction(messageId: string, emoji: string): Promise<void> {
    const result = await this.client.call<ToggleResult | null>(
      "reactions:toggle",
      { messageId, emoji },
      "mutation",
    );
    if (result?.added === true) {
      await this.client.call("reactions:toggle", { messageId, emoji }, "mutation");
    }
  }

  private async listMembers(): Promise<Member[]> {
    return await this.client.call<Member[]>("members:list", {});
  }

  private handlePoll(result: BotPollResult): void {
    this.polledIdentity = { userId: result.me.userId, name: result.me.name };
    if (!this.readyEmitted) {
      this.readyEmitted = true;
      this.emitter.dispatch("ready", this.polledIdentity);
    }
    for (const event of result.events) {
      if (event.self && !this.config.includeSelf) {
        continue;
      }
      this.dispatchEvent(event);
    }
  }

  private dispatchEvent(event: BotEvent): void {
    switch (event.type) {
      case "message.created":
        this.emitMessage("message", event);
        break;
      case "message.updated":
        this.emitMessage("messageUpdate", event);
        break;
      case "message.deleted":
        this.emitMessage("messageDelete", event);
        break;
      case "reaction.added":
        this.emitReaction("reactionAdd", event);
        break;
      case "reaction.removed":
        this.emitReaction("reactionRemove", event);
        break;
    }
  }

  private emitMessage(name: "message" | "messageUpdate" | "messageDelete", event: BotEvent): void {
    if (event.message === null) {
      return;
    }
    const message = this.toMessage(event.message);
    if (name === "message") {
      this.emitter.dispatch("message", message);
    } else if (name === "messageUpdate") {
      this.emitter.dispatch("messageUpdate", message);
    } else {
      this.emitter.dispatch("messageDelete", message);
    }
  }

  private emitReaction(name: "reactionAdd" | "reactionRemove", event: BotEvent): void {
    if (event.reaction === null) {
      return;
    }
    const reaction: ReactionEvent = {
      messageId: event.reaction.messageId,
      channelId: event.channelId,
      userId: event.reaction.userId,
      emoji: event.reaction.emoji,
      self: event.self,
    };
    if (name === "reactionAdd") {
      this.emitter.dispatch("reactionAdd", reaction);
    } else {
      this.emitter.dispatch("reactionRemove", reaction);
    }
  }

  private toMessage(source: BotEventMessage): Message {
    return new Message(
      {
        id: source.id,
        channelId: source.channelId,
        authorId: source.authorId,
        body: source.body,
        threadRootId: source.threadRootId,
        replyToId: source.replyToId,
        mentionUserIds: source.mentionUserIds,
        createdAt: source.createdAt,
        editedAt: source.editedAt ?? null,
        deletedAt: source.deletedAt ?? null,
      },
      this.actions,
    );
  }

  private emitError(error: unknown): void {
    if (this.reportingError) {
      return;
    }
    this.reportingError = true;
    try {
      this.emitter.dispatch("error", toError(error));
    } finally {
      this.reportingError = false;
    }
  }
}
