/**
 * The framework-agnostic chat session.
 *
 * This owns the whole MLS lifecycle and the send/receive pipeline:
 *
 * 1. **Sign-in** — register the device (public identity only), generate a
 *    batch of KeyPackages and publish them for other devices to consume.
 * 2. **Channel bootstrap** — when a channel is opened: reuse the locally
 *    persisted group if there is one; otherwise publish a join intent and wait
 *    for a Welcome; otherwise, as the first joiner, create the group, persist
 *    the group id and append the initial commit.
 * 3. **Auto-approve** — while a channel is open, watch join intents, consume
 *    the requester's KeyPackage, build `addMembers` and append the commit +
 *    Welcome so a joining device can complete on its next poll.
 * 4. **Send/receive** — encrypt through the engine, store ciphertext + current
 *    epoch, decrypt every incoming message, and advance the epoch as commits
 *    arrive. All engine work happens off the UI thread (Worker on web, direct
 *    fallback otherwise).
 *
 * The session never logs plaintext, keys or tokens.
 */

import type { AddMembersResult, MlsEngine, MlsMember } from "@aulora/crypto";
import { MlsEngineError } from "@aulora/crypto";
import {
  channelGroupId,
  decodeMlsBytes,
  decodePayload,
  encodeMlsBytes,
  encodePayload,
  encodeText,
} from "./mls-encoding.js";
import type {
  ChannelSummary,
  ChatPort,
  ChatSubscriptions,
  JoinIntentRow,
  MessagePayload,
  MlsCommitRow,
  ReactionRow,
} from "./port.js";

/** Plaintext application payload for one message. Never sent to the server. */
export interface MessagePayloadBody {
  readonly t: string;
  readonly edited?: boolean;
  readonly threadRootId?: string;
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
  readonly engine: MlsEngine;
  readonly user: SessionUser;
  /** Public half of this device's MLS identity, stored on the device record. */
  readonly identityKey: string;
  /** Platform tag for the device record. Defaults to `"web"`. */
  readonly platform?: string;
  /** How many unused KeyPackages to keep published. Defaults to 3. */
  readonly keyPackageTarget?: number;
}

interface ChannelState {
  readonly channelId: string;
  groupId: string;
  readonly unsubscribers: (() => void)[];
  /** The KeyPackage reserved for a Welcome, when waiting to be added. */
  pendingWelcomeKeyPackage: Uint8Array | undefined;
  /** KeyPackage backing each local group, retained for rejoins. */
  groupKeyPackage: Uint8Array | undefined;
  /** Resolved by the Welcome handler when this device joins mid-bootstrap. */
  joinedResolve: (() => void) | undefined;
  starting: Promise<void> | undefined;
  ready: boolean;
}

export interface OpenChannelResult {
  readonly role: "creator" | "joiner";
  readonly epoch: number;
}

export class MlsSessionError extends Error {
  readonly code: "not-started" | "no-key-package" | "group-open-failed" | "no-group";
  constructor(code: MlsSessionError["code"], message: string) {
    super(message);
    this.name = "MlsSessionError";
    this.code = code;
  }
}

/**
 * Owns MLS state for one signed-in device. One instance per browser tab /
 * client; it is cheap to construct and holds no module-level state.
 */
export class ChatSession {
  private readonly port: ChatPort;
  private readonly subscriptions: ChatSubscriptions;
  private readonly engine: MlsEngine;
  private readonly user: SessionUser;
  private readonly identityKey: string;
  private readonly platform: string;
  private readonly keyPackageTarget: number;

  private deviceId: string | undefined;
  private started: Promise<void> | undefined;
  private startedResolve: (() => void) | undefined;

  private readonly channels = new Map<string, ChannelState>();
  private readonly decrypted = new Map<string, string>();
  private readonly messageListeners = new Set<(messages: readonly MessagePayload[]) => void>();
  private readonly decryptedListeners = new Set<(messages: readonly MessagePayload[]) => void>();
  private readonly reactionListeners = new Map<
    string,
    Set<(reactions: readonly ReactionPayload[]) => void>
  >();
  private readonly reactionCache = new Map<string, ReactionPayload[]>();
  private readonly reactionUnsubscribers = new Map<string, () => void>();
  private latestMessages: readonly MessagePayload[] = [];

  private constructor(options: SessionOptions) {
    this.port = options.port;
    this.subscriptions = options.subscriptions;
    this.engine = options.engine;
    this.user = options.user;
    this.identityKey = options.identityKey;
    this.platform = options.platform ?? "web";
    this.keyPackageTarget = options.keyPackageTarget ?? 3;
  }

  /** Builds a session. The engine should already be connected to the Worker. */
  static create(options: SessionOptions): ChatSession {
    return new ChatSession(options);
  }

  /** This device's server-side id, available after {@link start}. */
  get id(): string | undefined {
    return this.deviceId;
  }

  /**
   * Sign-in lifecycle: register the device and publish unused KeyPackages.
   * Idempotent; concurrent callers await the same work.
   */
  async start(): Promise<void> {
    if (this.started) {
      return this.started;
    }
    this.started = new Promise<void>((resolve) => {
      this.startedResolve = resolve;
    });
    void this.runStart();
    return this.started;
  }

  private async runStart(): Promise<void> {
    const { deviceId } = await this.port.upsertDevice({
      platform: this.platform,
      identityKey: this.identityKey,
    });
    this.deviceId = deviceId;
    await this.replenishKeyPackages();
    this.startedResolve?.();
  }

  /** Publishes KeyPackages until `keyPackageTarget` are unused. */
  async replenishKeyPackages(): Promise<void> {
    if (this.deviceId === undefined) {
      return;
    }
    for (let index = 0; index < this.keyPackageTarget; index += 1) {
      const keyPackage = await this.engine.generateKeyPackage();
      await this.port.publishKeyPackage({
        deviceId: this.deviceId,
        keyPackage: encodeMlsBytes(keyPackage),
      });
    }
  }

  private requireDeviceId(): string {
    if (this.deviceId === undefined) {
      throw new MlsSessionError("not-started", "ChatSession.start() has not completed");
    }
    return this.deviceId;
  }

  private requireGroup(channelId: string): ChannelState {
    const state = this.channels.get(channelId);
    if (state === undefined || !state.ready) {
      throw new MlsSessionError("no-group", `no MLS group for channel ${channelId}`);
    }
    return state;
  }

  /**
   * Opens (or reuses) the MLS group for a channel and wires its
   * subscriptions. Safe to call repeatedly for the same channel.
   */
  async openChannel(channel: ChannelSummary): Promise<OpenChannelResult> {
    const existing = this.channels.get(channel.id);
    if (existing !== undefined) {
      await existing.starting;
      if (!existing.ready) {
        throw new MlsSessionError("group-open-failed", "channel group is not ready");
      }
      return {
        role: existing.groupKeyPackage === undefined ? "joiner" : "creator",
        epoch: Number(await this.engine.epoch()),
      };
    }

    const state: ChannelState = {
      channelId: channel.id,
      groupId: channel.mlsGroupId ?? encodeMlsBytes(channelGroupId(channel.id)),
      unsubscribers: [],
      pendingWelcomeKeyPackage: undefined,
      groupKeyPackage: undefined,
      joinedResolve: undefined,
      starting: undefined,
      ready: false,
    };
    this.channels.set(channel.id, state);
    state.starting = this.bootstrapChannel(channel, state);
    await state.starting;
    const role = state.groupKeyPackage === undefined ? "joiner" : "creator";
    return { role, epoch: Number(await this.engine.epoch()) };
  }

  private async bootstrapChannel(channel: ChannelSummary, state: ChannelState): Promise<void> {
    this.wireChannelSubscriptions(channel, state);

    // 1. Reuse a locally persisted group for this channel, if the engine holds
    //    one (its active group is re-provisioned from the key store on demand).
    if (await this.hasLocalGroup()) {
      state.ready = true;
      return;
    }

    // 2. Otherwise publish a join intent and wait for a Welcome. A member's
    //    client services the intent with `addMembers` + `appendCommit`; the
    //    Welcome arrives through the commits subscription above.
    const keyPackage = await this.engine.generateKeyPackage();
    state.pendingWelcomeKeyPackage = keyPackage;
    const joined = this.waitForWelcome(channel.id, state);
    await this.port.publishJoinIntent({
      channelId: channel.id,
      deviceId: this.requireDeviceId(),
      keyPackage: encodeMlsBytes(keyPackage),
    });
    if (await joined) {
      return;
    }

    // 3. Otherwise this device is the first joiner: create the group, persist
    //    the group id and append the initial commit (zero members added).
    const createKeyPackage = state.pendingWelcomeKeyPackage;
    if (createKeyPackage === undefined) {
      throw new MlsSessionError("no-key-package", "no KeyPackage available to create the group");
    }
    await this.engine.createGroup(channelGroupId(channel.id), createKeyPackage);
    state.pendingWelcomeKeyPackage = undefined;
    state.groupKeyPackage = createKeyPackage;
    state.groupId = encodeMlsBytes(channelGroupId(channel.id));
    const epoch = Number(await this.engine.epoch());
    const initialState = await this.engine.exportState();
    if (channel.mlsGroupId === null) {
      await this.port.setMlsGroupId({ channelId: channel.id, mlsGroupId: state.groupId });
    }
    await this.port.appendCommit({
      channelId: channel.id,
      epoch,
      commitCiphertext: encodeMlsBytes(initialState),
    });
    state.ready = true;
  }

  private async hasLocalGroup(): Promise<boolean> {
    try {
      await this.engine.members();
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves `true` when the Welcome subscription joins this device. */
  private waitForWelcome(channelId: string, state: ChannelState): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        state.joinedResolve = undefined;
        resolve(value);
      };
      state.joinedResolve = () => finish(true);
      // A tick with no Welcome means this device is the first joiner.
      queueMicrotask(() => finish(false));
      void channelId;
    });
  }

  private wireChannelSubscriptions(channel: ChannelSummary, state: ChannelState): void {
    state.unsubscribers.push(
      this.subscriptions.watchMessages(channel.id, (messages) => {
        void this.receiveMessages(messages);
      }),
    );
    state.unsubscribers.push(
      this.subscriptions.watchCommits(channel.id, -1, (commits) => {
        void this.onCommitSnapshot(channel.id, state, commits);
      }),
    );
    state.unsubscribers.push(
      this.subscriptions.watchJoinIntents(channel.id, (intents) => {
        void this.autoApproveJoins(state, intents);
      }),
    );
  }

  /**
   * Handles a commit snapshot: a Welcome addressed to a still-waiting device
   * is joined first, then any remaining commits are applied as handshakes.
   */
  private async onCommitSnapshot(
    channelId: string,
    state: ChannelState,
    commits: readonly MlsCommitRow[],
  ): Promise<void> {
    if (!state.ready && state.pendingWelcomeKeyPackage !== undefined) {
      const welcome = latestWelcome(commits);
      if (welcome !== null) {
        try {
          await this.engine.joinFromWelcome(
            decodeMlsBytes(welcome),
            state.pendingWelcomeKeyPackage,
          );
          state.pendingWelcomeKeyPackage = undefined;
          state.groupKeyPackage = undefined;
          state.groupId = encodeMlsBytes(channelGroupId(channelId));
          state.ready = true;
          state.joinedResolve?.();
        } catch {
          // Not addressed to this device (or already consumed); keep waiting.
        }
      }
    }
    await this.applyCommits(state, commits);
  }

  /** Auto-approve: an online member services pending joins with add + welcome. */
  async autoApproveJoins(state: ChannelState, intents: readonly JoinIntentRow[]): Promise<void> {
    if (!state.ready || intents.length === 0) {
      return;
    }
    const ownDevice = this.deviceId;
    const keyPackages: Uint8Array[] = [];
    const accepted: JoinIntentRow[] = [];
    for (const intent of intents) {
      if (intent.deviceId === ownDevice) {
        continue;
      }
      keyPackages.push(decodeMlsBytes(intent.keyPackage));
      accepted.push(intent);
    }
    if (keyPackages.length === 0) {
      return;
    }
    let result: AddMembersResult;
    try {
      result = await this.engine.addMembers(keyPackages);
    } catch {
      return;
    }
    const epoch = Number(await this.engine.epoch());
    await this.port.appendCommit({
      channelId: state.channelId,
      epoch,
      commitCiphertext: encodeMlsBytes(result.commit),
      welcomeCiphertext: encodeMlsBytes(result.welcome),
    });
    for (const intent of accepted) {
      await this.port.markJoinIntentServiced({ intentId: intent.id });
    }
  }

  /** Applies incoming handshake commits after the local epoch. */
  async applyCommits(state: ChannelState, commits: readonly MlsCommitRow[]): Promise<void> {
    if (!state.ready) {
      return;
    }
    let local: bigint;
    try {
      local = await this.engine.epoch();
    } catch {
      return;
    }
    const pending = [...commits]
      .filter((commit) => BigInt(commit.epoch) > local)
      .sort((a, b) => a.epoch - b.epoch);
    for (const commit of pending) {
      try {
        await this.engine.processCommit(decodeMlsBytes(commit.commitCiphertext));
      } catch {
        // A commit we cannot process (already applied, or not for us) is
        // skipped; the epoch guard above keeps this bounded.
      }
    }
  }

  /** Decrypts an incoming message list and notifies subscribers. */
  async receiveMessages(messages: readonly MessagePayload[]): Promise<void> {
    this.latestMessages = messages;
    for (const message of messages) {
      if (this.decrypted.has(message.id) || message.deletedAt !== null) {
        continue;
      }
      try {
        const bytes = await this.engine.decrypt(decodeMlsBytes(message.ciphertext));
        this.decrypted.set(message.id, decodePayload<MessagePayloadBody>(bytes).t);
      } catch (error) {
        if (error instanceof MlsEngineError || error instanceof Error) {
          // Undecryptable (e.g. history before this device joined): keep the
          // row but leave it blank rather than crashing the list.
          continue;
        }
        throw error;
      }
    }
    for (const listener of this.messageListeners) {
      listener(messages);
    }
    for (const listener of this.decryptedListeners) {
      listener(messages);
    }
  }

  /** Decrypted plaintext for a message id, or `undefined` if not openable. */
  decryptedText(messageId: string): string | undefined {
    return this.decrypted.get(messageId);
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

  /**
   * Sends `text` to a channel: encrypt, store ciphertext + epoch, and clear
   * the caller's typing row.
   */
  async sendMessage(
    channelId: string,
    text: string,
    options: {
      readonly mentionUserIds?: readonly string[];
      readonly threadRootId?: string;
      readonly attachmentIds?: readonly string[];
    } = {},
  ): Promise<string> {
    const state = this.requireGroup(channelId);
    const epoch = Number(await this.engine.epoch());
    const body: MessagePayloadBody = options.threadRootId
      ? { t: text, threadRootId: options.threadRootId }
      : { t: text };
    const ciphertext = encodeMlsBytes(await this.engine.encrypt(encodePayload(body)));
    const messageId = await this.port.sendMessage({
      channelId,
      ciphertext,
      epoch,
      ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
      ...(options.mentionUserIds !== undefined ? { mentionUserIds: options.mentionUserIds } : {}),
      ...(options.attachmentIds !== undefined ? { attachmentIds: options.attachmentIds } : {}),
      ...(this.deviceId !== undefined ? { authorDeviceId: this.deviceId } : {}),
    });
    this.decrypted.set(messageId, text);
    await this.port.clearTyping({ channelId });
    void state;
    return messageId;
  }

  /** Edits a message with a fresh encryption at the current epoch. */
  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    this.requireGroup(channelId);
    const existing = this.latestMessages.find((message) => message.id === messageId);
    const epoch = Number(await this.engine.epoch());
    const body: MessagePayloadBody = {
      t: text,
      edited: true,
      ...(existing?.threadRootId ? { threadRootId: existing.threadRootId } : {}),
    };
    const ciphertext = encodeMlsBytes(await this.engine.encrypt(encodePayload(body)));
    await this.port.editMessage({ messageId, ciphertext, epoch });
    this.decrypted.set(messageId, text);
  }

  /** Soft-deletes a message and drops its local plaintext. */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.requireGroup(channelId);
    await this.port.deleteMessage({ messageId });
    this.decrypted.delete(messageId);
  }

  async pinMessage(channelId: string, messageId: string): Promise<void> {
    this.requireGroup(channelId);
    await this.port.pinMessage({ messageId });
  }

  async unpinMessage(channelId: string, messageId: string): Promise<void> {
    this.requireGroup(channelId);
    await this.port.unpinMessage({ messageId });
  }

  /** Toggles a reaction, encrypting the emoji and caching its plaintext. */
  async toggleReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    this.requireGroup(channelId);
    const emojiCiphertext = encodeMlsBytes(await this.engine.encrypt(encodeText(emoji)));
    await this.port.toggleReaction({ messageId, emojiCiphertext });

    const existing = this.reactionCache.get(messageId) ?? [];
    const index = existing.findIndex(
      (reaction) =>
        reaction.userId === this.user.id && reaction.emojiCiphertext === emojiCiphertext,
    );
    const next = [...existing];
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push({ userId: this.user.id, emoji, emojiCiphertext });
    }
    this.emitReactions(messageId, next);
  }

  private async decryptReactions(
    messageId: string,
    rows: readonly ReactionRow[],
  ): Promise<ReactionPayload[]> {
    const resolved: ReactionPayload[] = [];
    for (const row of rows) {
      try {
        const bytes = await this.engine.decrypt(decodeMlsBytes(row.emojiCiphertext));
        resolved.push({
          userId: row.userId,
          emoji: decodePayload<{ text: string }>(bytes).text,
          emojiCiphertext: row.emojiCiphertext,
        });
      } catch {}
    }
    void messageId;
    return resolved;
  }

  /** Decrypts and groups the reactions on a message, emitting the result. */
  async loadReactions(messageId: string, rows: readonly ReactionRow[]): Promise<ReactionPayload[]> {
    const resolved = await this.decryptReactions(messageId, rows);
    this.emitReactions(messageId, resolved);
    return resolved;
  }

  private emitReactions(messageId: string, reactions: readonly ReactionPayload[]): void {
    this.reactionCache.set(messageId, [...reactions]);
    for (const listener of this.reactionListeners.get(messageId) ?? []) {
      listener(reactions);
    }
  }

  onReactions(
    messageId: string,
    listener: (reactions: readonly ReactionPayload[]) => void,
  ): () => void {
    const set = this.reactionListeners.get(messageId) ?? new Set();
    set.add(listener);
    this.reactionListeners.set(messageId, set);
    listener(this.reactionCache.get(messageId) ?? []);
    return () => {
      set.delete(listener);
    };
  }

  /** Current members of the channel's MLS group (local view). */
  async groupMembers(channelId: string): Promise<readonly MlsMember[]> {
    this.requireGroup(channelId);
    return await this.engine.members();
  }

  /** Current local MLS epoch for a channel. */
  async epoch(channelId: string): Promise<number> {
    this.requireGroup(channelId);
    return Number(await this.engine.epoch());
  }

  /** Closes subscriptions and forgets channel state. */
  closeChannel(channelId: string): void {
    const state = this.channels.get(channelId);
    if (state === undefined) {
      return;
    }
    for (const unsubscribe of state.unsubscribers) {
      unsubscribe();
    }
    this.channels.delete(channelId);
  }

  /** Releases every subscription (e.g. on sign-out). */
  dispose(): void {
    for (const channelId of [...this.channels.keys()]) {
      this.closeChannel(channelId);
    }
    for (const unsubscribe of this.reactionUnsubscribers.values()) {
      unsubscribe();
    }
    this.reactionUnsubscribers.clear();
    this.messageListeners.clear();
    this.decryptedListeners.clear();
    this.reactionListeners.clear();
  }

  /** Leaves a channel; the caller's client then publishes the Remove commit. */
  async leaveChannel(channelId: string): Promise<void> {
    await this.port.leaveChannel({ channelId });
  }

  /** Marks a message as the caller's read cursor. */
  async markRead(channelId: string, messageId: string): Promise<void> {
    await this.port.setReadState({ channelId, lastReadMessageId: messageId });
  }
}

export interface ReactionPayload {
  readonly userId: string;
  readonly emoji: string;
  readonly emojiCiphertext: string;
}

function latestWelcome(commits: readonly MlsCommitRow[]): string | null {
  const withWelcome = commits
    .filter((commit) => commit.welcomeCiphertext !== null)
    .sort((a, b) => b.epoch - a.epoch);
  return withWelcome[0]?.welcomeCiphertext ?? null;
}
