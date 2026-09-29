/**
 * The framework-agnostic chat session.
 *
 * This is a plaintext conversation store and orchestrator: it caches message
 * bodies, attachment descriptors, reactions and channel names, and forwards
 * reads and writes to a {@link ChatPort}. It holds no keys and never imports a
 * crypto or MLS module — the server seals content at rest with its External Key
 * Manager and returns plaintext to the client.
 *
 * The public method names match the previous MLS-backed session so the apps
 * only need to change the shape of what they pass, not the UI.
 */

import type {
  AttachmentDescriptor,
  ChannelSummary,
  ChatPort,
  ChatSubscriptions,
  MessagePayload,
  PresenceRow,
  ReactionRow,
  StoredFileView,
} from "./port.js";

/** Plaintext application payload for one message. */
export interface MessagePayloadBody {
  readonly t: string;
  readonly edited?: boolean;
  readonly threadRootId?: string;
  readonly replyToId?: string;
  /** Attachment descriptors resolved from the message's `attachmentIds`. */
  readonly attachments?: readonly AttachmentDescriptor[];
}

export interface SessionUser {
  readonly id: string;
  /** Display name used for mention resolution. */
  readonly displayName: string;
}

export interface SessionMember extends SessionUser {
  readonly roleIds?: readonly string[];
  readonly nickname?: string;
  readonly isOwner?: boolean;
}

export interface SessionOptions {
  readonly port: ChatPort;
  readonly subscriptions: ChatSubscriptions;
}

/** A reaction as the session exposes it to listeners. */
export interface ReactionPayload {
  readonly userId: string;
  readonly emoji: string;
}

/** Placeholder label for a channel whose plaintext name is not known. */
const FALLBACK_CHANNEL_NAME = "channel";

/** Shared empty list so a message without attachments returns a stable value. */
const EMPTY_ATTACHMENTS: readonly AttachmentDescriptor[] = [];

interface OpenChannelState {
  readonly unsubscribers: (() => void)[];
}

function parseDimensions(value: string | null): AttachmentDescriptor["dimensions"] {
  if (value === null || value.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as { width?: unknown; height?: unknown };
    if (
      typeof parsed.width === "number" &&
      typeof parsed.height === "number" &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return { width: parsed.width, height: parsed.height };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function descriptorFromStoredFile(file: StoredFileView): AttachmentDescriptor | null {
  if (file.name === null || file.name.length === 0) {
    return null;
  }
  const dimensions = parseDimensions(file.dimensions);
  const blurhash = file.blurhash ?? undefined;
  return {
    fileId: file.id,
    name: file.name,
    mime: file.mime ?? "application/octet-stream",
    size: file.sizeBytes,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(blurhash !== undefined ? { blurhash } : {}),
  };
}

/**
 * Owns the plaintext cache for one signed-in client. One instance per browser
 * tab / app session; it is cheap to construct and holds no module-level state.
 */
export class ChatSession {
  private readonly port: ChatPort;
  private readonly subscriptions: ChatSubscriptions;

  private started: Promise<void> | undefined;
  private readonly startUnsubscribers: (() => void)[] = [];

  private readonly openChannels = new Map<string, OpenChannelState>();
  private readonly channelNames = new Map<string, string>();
  private channelSummaries: readonly ChannelSummary[] = [];
  private latestPresence: readonly PresenceRow[] = [];

  private latestMessages: readonly MessagePayload[] = [];
  private readonly decrypted = new Map<string, string>();
  private readonly bodies = new Map<string, MessagePayloadBody>();
  /**
   * Resolved attachment descriptors keyed by file id, and per-message parsed
   * lists. Caching both means a live message update never re-fetches file
   * metadata or re-validates descriptors that have not changed: a channel with
   * thousands of messages still resolves each file at most once.
   */
  private readonly fileDescriptors = new Map<string, AttachmentDescriptor | null>();
  private readonly messageAttachments = new Map<string, readonly AttachmentDescriptor[]>();
  private readonly pendingFileIds = new Set<string>();
  private readonly messageListeners = new Set<(messages: readonly MessagePayload[]) => void>();
  private readonly decryptedListeners = new Set<(messages: readonly MessagePayload[]) => void>();
  private readonly reactionListeners = new Map<
    string,
    Set<(reactions: readonly ReactionRow[]) => void>
  >();
  private readonly reactionCache = new Map<string, ReactionRow[]>();

  private constructor(options: SessionOptions) {
    this.port = options.port;
    this.subscriptions = options.subscriptions;
  }

  /** Builds a session. No device or key setup is required. */
  static create(options: SessionOptions): ChatSession {
    return new ChatSession(options);
  }

  /**
   * Starts the session: subscribes to the workspace channel list and presence.
   * Idempotent; concurrent callers await the same work.
   */
  start(): Promise<void> {
    if (this.started !== undefined) {
      return this.started;
    }
    this.startUnsubscribers.push(
      this.subscriptions.watchChannels((channels) => {
        this.hydrateChannelNames(channels);
      }),
    );
    this.startUnsubscribers.push(
      this.subscriptions.watchPresence((presence) => {
        this.latestPresence = presence;
      }),
    );
    this.started = Promise.resolve();
    return this.started;
  }

  /** The latest channel summaries observed by {@link start}. */
  channels(): readonly ChannelSummary[] {
    return this.channelSummaries;
  }

  /** The latest presence rows observed by {@link start}. */
  presence(): readonly PresenceRow[] {
    return this.latestPresence;
  }

  /**
   * Opens a channel: subscribes to its message stream and remembers its
   * plaintext name. Safe to call repeatedly for the same channel.
   */
  async openChannel(channel: ChannelSummary): Promise<void> {
    this.rememberName(channel.id, channel.name);
    if (this.openChannels.has(channel.id)) {
      return;
    }
    const state: OpenChannelState = { unsubscribers: [] };
    this.openChannels.set(channel.id, state);
    state.unsubscribers.push(
      this.subscriptions.watchMessages(channel.id, (messages) => {
        void this.receiveMessages(messages);
      }),
    );
  }

  /** Closes subscriptions and forgets channel state. */
  closeChannel(channelId: string): void {
    const state = this.openChannels.get(channelId);
    if (state === undefined) {
      return;
    }
    for (const unsubscribe of state.unsubscribers) {
      unsubscribe();
    }
    this.openChannels.delete(channelId);
  }

  /**
   * Ingests a plaintext message list: caches each body, resolves attachments,
   * and notifies subscribers. Deleted messages are skipped.
   */
  async receiveMessages(messages: readonly MessagePayload[]): Promise<void> {
    this.latestMessages = messages;
    await this.hydrateAttachments(messages);
    for (const message of messages) {
      if (message.deletedAt !== null) {
        continue;
      }
      const base: MessagePayloadBody = {
        t: message.body,
        ...(message.editedAt !== null ? { edited: true } : {}),
        ...(message.threadRootId !== null ? { threadRootId: message.threadRootId } : {}),
        ...(message.replyToId !== null && message.replyToId !== undefined
          ? { replyToId: message.replyToId }
          : {}),
      };
      const attachments = this.messageAttachments.get(message.id);
      this.decrypted.set(message.id, message.body);
      this.bodies.set(
        message.id,
        attachments !== undefined && attachments.length > 0 ? { ...base, attachments } : base,
      );
    }
    for (const listener of this.messageListeners) {
      listener(messages);
    }
    for (const listener of this.decryptedListeners) {
      listener(messages);
    }
  }

  /**
   * Resolves the attachment descriptors for a page of messages in one batched
   * file read, reusing anything already cached. Files that are gone are cached
   * as `null` so a missing upload is not retried on every live tick.
   */
  private async hydrateAttachments(messages: readonly MessagePayload[]): Promise<void> {
    const needed: string[] = [];
    for (const message of messages) {
      if (message.deletedAt !== null || message.attachmentIds.length === 0) {
        continue;
      }
      for (const fileId of message.attachmentIds) {
        if (!this.fileDescriptors.has(fileId) && !this.pendingFileIds.has(fileId)) {
          needed.push(fileId);
        }
      }
    }
    await this.ensureFileDescriptors(needed);
    for (const message of messages) {
      if (message.deletedAt !== null || message.attachmentIds.length === 0) {
        continue;
      }
      const list: AttachmentDescriptor[] = [];
      for (const fileId of message.attachmentIds) {
        const descriptor = this.fileDescriptors.get(fileId);
        if (descriptor !== undefined && descriptor !== null) {
          list.push(descriptor);
        }
      }
      this.messageAttachments.set(message.id, list);
    }
  }

  private async ensureFileDescriptors(fileIds: readonly string[]): Promise<void> {
    const needed = new Set<string>();
    for (const fileId of fileIds) {
      if (!this.fileDescriptors.has(fileId) && !this.pendingFileIds.has(fileId)) {
        needed.add(fileId);
      }
    }
    if (needed.size === 0) {
      return;
    }
    const ids = [...needed];
    for (const id of ids) {
      this.pendingFileIds.add(id);
    }
    try {
      const files = await this.port.getFiles({ fileIds: ids });
      for (const file of files) {
        this.fileDescriptors.set(file.id, descriptorFromStoredFile(file));
      }
      for (const id of ids) {
        if (!this.fileDescriptors.has(id)) {
          this.fileDescriptors.set(id, null);
        }
      }
    } finally {
      for (const id of ids) {
        this.pendingFileIds.delete(id);
      }
    }
  }

  onMessages(listener: (messages: readonly MessagePayload[]) => void): () => void {
    this.messageListeners.add(listener);
    listener(this.latestMessages);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onDecrypted(listener: (messages: readonly MessagePayload[]) => void): () => void {
    this.decryptedListeners.add(listener);
    listener(this.latestMessages);
    return () => {
      this.decryptedListeners.delete(listener);
    };
  }

  /** Cached plaintext body for a message id; `""` when unknown. */
  decryptedText(messageId: string): string {
    return this.decrypted.get(messageId) ?? "";
  }

  /** Full body for a message id, including attachments and thread info. */
  decryptedBody(messageId: string): MessagePayloadBody | undefined {
    return this.bodies.get(messageId);
  }

  /** Validated attachment descriptors for a message, or an empty list. */
  attachmentsFor(messageId: string): readonly AttachmentDescriptor[] {
    return this.messageAttachments.get(messageId) ?? EMPTY_ATTACHMENTS;
  }

  private async resolveAttachments(
    fileIds: readonly string[],
  ): Promise<readonly AttachmentDescriptor[]> {
    await this.ensureFileDescriptors(fileIds);
    const descriptors: AttachmentDescriptor[] = [];
    for (const fileId of fileIds) {
      const descriptor = this.fileDescriptors.get(fileId);
      if (descriptor !== undefined && descriptor !== null) {
        descriptors.push(descriptor);
      }
    }
    return descriptors;
  }

  /**
   * Sends `text` to a channel: persists the plaintext body and caches it
   * locally so the caller's own message renders immediately.
   */
  async sendMessage(
    channelId: string,
    text: string,
    options: {
      readonly threadRootId?: string;
      readonly replyToId?: string;
      readonly mentionUserIds?: readonly string[];
      readonly mentionChannelIds?: readonly string[];
      readonly mentionCategoryIds?: readonly string[];
      readonly attachmentIds?: readonly string[];
    } = {},
  ): Promise<string> {
    const attachmentIds = options.attachmentIds ?? [];
    const messageId = await this.port.sendMessage({
      channelId,
      body: text,
      ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
      ...(options.replyToId !== undefined ? { replyToId: options.replyToId } : {}),
      ...(options.mentionUserIds !== undefined ? { mentionUserIds: options.mentionUserIds } : {}),
      ...(options.mentionChannelIds !== undefined
        ? { mentionChannelIds: options.mentionChannelIds }
        : {}),
      ...(options.mentionCategoryIds !== undefined
        ? { mentionCategoryIds: options.mentionCategoryIds }
        : {}),
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
    let body: MessagePayloadBody = {
      t: text,
      ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
      ...(options.replyToId !== undefined ? { replyToId: options.replyToId } : {}),
    };
    if (attachmentIds.length > 0) {
      const attachments = await this.resolveAttachments(attachmentIds);
      if (attachments.length > 0) {
        body = { ...body, attachments };
      }
    }
    this.decrypted.set(messageId, text);
    this.bodies.set(messageId, body);
    return messageId;
  }

  /** Edits a message, preserving its thread and attachment metadata. */
  async editMessage(_channelId: string, messageId: string, text: string): Promise<void> {
    await this.port.editMessage({ messageId, body: text });
    const existing = this.bodies.get(messageId);
    this.bodies.set(messageId, {
      ...(existing ?? {}),
      t: text,
      edited: true,
    });
    this.decrypted.set(messageId, text);
  }

  /** Soft-deletes a message and drops its local plaintext. */
  async deleteMessage(_channelId: string, messageId: string): Promise<void> {
    await this.port.deleteMessage({ messageId });
    this.decrypted.delete(messageId);
    this.bodies.delete(messageId);
    this.messageAttachments.delete(messageId);
  }

  async pinMessage(_channelId: string, messageId: string): Promise<void> {
    await this.port.pinMessage({ messageId });
  }

  async unpinMessage(_channelId: string, messageId: string): Promise<void> {
    await this.port.unpinMessage({ messageId });
  }

  /** Toggles a plaintext emoji reaction for the caller. */
  async toggleReaction(_channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.port.toggleReaction({ messageId, emoji });
  }

  /** Records the reactions for a message and emits them to listeners. */
  loadReactions(
    _channelId: string,
    messageId: string,
    rows: readonly ReactionRow[],
  ): Promise<readonly ReactionRow[]> {
    const resolved = [...rows];
    this.emitReactions(messageId, resolved);
    return Promise.resolve(resolved);
  }

  private emitReactions(messageId: string, reactions: readonly ReactionRow[]): void {
    this.reactionCache.set(messageId, [...reactions]);
    for (const listener of this.reactionListeners.get(messageId) ?? []) {
      listener(reactions);
    }
  }

  onReactions(
    messageId: string,
    listener: (reactions: readonly ReactionRow[]) => void,
  ): () => void {
    const set = this.reactionListeners.get(messageId) ?? new Set();
    set.add(listener);
    this.reactionListeners.set(messageId, set);
    listener(this.reactionCache.get(messageId) ?? []);
    return () => {
      set.delete(listener);
    };
  }

  /** Renames a channel with its plaintext name. */
  async setChannelName(channelId: string, name: string): Promise<void> {
    this.rememberName(channelId, name);
    await this.port.renameChannel({ channelId, name });
  }

  /** The plaintext name for a channel, or a fallback label. */
  channelNameFor(channelId: string, name: string | null | undefined): string {
    if (name !== null && name !== undefined && name.length > 0) {
      return name;
    }
    return this.channelNames.get(channelId) ?? FALLBACK_CHANNEL_NAME;
  }

  /** Remembers plaintext names from channel summaries. */
  hydrateChannelNames(channels: readonly ChannelSummary[]): void {
    this.channelSummaries = channels;
    for (const channel of channels) {
      this.rememberName(channel.id, channel.name);
    }
  }

  private rememberName(channelId: string, name: string | null | undefined): void {
    if (name === null || name === undefined || name.length === 0) {
      return;
    }
    this.channelNames.set(channelId, name);
  }

  /** Marks a message as the caller's read cursor. */
  async markRead(channelId: string, messageId: string): Promise<void> {
    await this.port.setReadState({ channelId, lastReadMessageId: messageId });
  }

  /** Releases every subscription (e.g. on sign-out). */
  dispose(): void {
    for (const channelId of [...this.openChannels.keys()]) {
      this.closeChannel(channelId);
    }
    for (const unsubscribe of this.startUnsubscribers) {
      unsubscribe();
    }
    this.startUnsubscribers.length = 0;
    this.messageListeners.clear();
    this.decryptedListeners.clear();
    this.reactionListeners.clear();
    this.reactionCache.clear();
  }
}
