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
  /**
   * Creates one MLS engine per channel. The `ts-mls` engine holds a single
   * active group at a time, so a channel-per-engine keeps concurrent channels
   * independent. Each call should return a fresh engine over the same device
   * key store (a Worker on web).
   */
  readonly createEngine: () => MlsEngine;
  readonly user: SessionUser;
  /** Public half of this device's MLS identity, stored on the device record. */
  readonly identityKey: string;
  /** Platform tag for the device record. Defaults to `"web"`. */
  readonly platform?: string;
  /** How many unused KeyPackages to keep published. Defaults to 3. */
  readonly keyPackageTarget?: number;
}

/** How long a joiner waits for an existing member to approve its Join. */
const JOIN_WAIT_MS = 15_000;

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
  /** One engine per channel, so concurrent groups never share an active state. */
  engine: MlsEngine;
  /**
   * The decrypted channel name, when this device owns it. Retained so the name
   * can be re-encrypted at the new epoch whenever the group changes, because a
   * device that joins later cannot read ciphertext from before it joined.
   */
  name: string | undefined;
  /** The epoch `name` was last published at, to avoid redundant rewrites. */
  nameEpoch: number | undefined;
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
  private readonly createEngine: () => MlsEngine;
  private readonly deviceEngine: MlsEngine;
  private readonly user: SessionUser;
  private readonly identityKey: string;
  private readonly platform: string;
  private readonly keyPackageTarget: number;

  private deviceId: string | undefined;
  private started: Promise<void> | undefined;
  private startedResolve: (() => void) | undefined;

  private readonly channels = new Map<string, ChannelState>();
  private readonly decrypted = new Map<string, string>();
  /** Ciphertext last decrypted per message id, so edits are reopened once. */
  private readonly messageCiphertexts = new Map<string, string>();
  /** In-flight decryption per message id, so concurrent calls do not race. */
  private readonly decrypting = new Map<string, Promise<void>>();
  /** Plaintext for payloads this device produced (MLS cannot reopen its own). */
  private readonly selfPayloads = new Map<string, unknown>();
  /** Plaintext for payloads this device opened, so each generation is consumed once. */
  private readonly payloadCache = new Map<string, unknown>();
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
    this.createEngine = options.createEngine;
    this.deviceEngine = options.createEngine();
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
      const keyPackage = await this.deviceEngine.generateKeyPackage();
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
        epoch: Number(await existing.engine.epoch()),
      };
    }

    const state: ChannelState = {
      channelId: channel.id,
      engine: this.createEngine(),
      groupId: channel.mlsGroupId ?? encodeMlsBytes(channelGroupId(channel.id)),
      unsubscribers: [],
      pendingWelcomeKeyPackage: undefined,
      groupKeyPackage: undefined,
      joinedResolve: undefined,
      starting: undefined,
      ready: false,
      name: undefined,
      nameEpoch: undefined,
    };
    this.channels.set(channel.id, state);
    state.starting = this.bootstrapChannel(channel, state);
    await state.starting;
    const role = state.groupKeyPackage === undefined ? "joiner" : "creator";
    return { role, epoch: Number(await state.engine.epoch()) };
  }

  private async bootstrapChannel(channel: ChannelSummary, state: ChannelState): Promise<void> {
    this.wireChannelSubscriptions(channel, state);

    // 1. Reuse a locally persisted group for this channel, if the engine holds
    //    one (its active group is re-provisioned from the key store on demand).
    if (await this.hasLocalGroup(state)) {
      state.ready = true;
      return;
    }

    // 2. Otherwise publish a join intent and wait for a Welcome. A member's
    //    client services the intent with `addMembers` + `appendCommit`; the
    //    Welcome arrives through the commits subscription above. A channel
    //    that already has a group id belongs to someone else, so wait longer
    //    for that member to approve; a channel with no group id means this
    //    device is the first joiner.
    const keyPackage = await state.engine.generateKeyPackage();
    state.pendingWelcomeKeyPackage = keyPackage;
    // Only an existing group needs a join intent; a channel with no group id
    // means this device is the first joiner and will create the group below.
    const needsApproval = channel.mlsGroupId !== null;
    const joined = needsApproval
      ? this.waitForWelcome(channel.id, state, JOIN_WAIT_MS)
      : Promise.resolve(false);
    if (needsApproval) {
      await this.port.publishJoinIntent({
        channelId: channel.id,
        deviceId: this.requireDeviceId(),
        keyPackage: encodeMlsBytes(keyPackage),
      });
    }
    if ((await joined) || state.ready) {
      return;
    }

    // A channel that already has a group but did not send us a Welcome means no
    // online member approved us yet; never fork it by creating our own group.
    if (channel.mlsGroupId !== null) {
      throw new MlsSessionError(
        "group-open-failed",
        "waiting for a member to approve this device's join",
      );
    }

    // 3. Otherwise this device is the first joiner: create the group, persist
    //    the group id and append the initial commit (zero members added).
    const createKeyPackage = state.pendingWelcomeKeyPackage;
    if (createKeyPackage === undefined) {
      throw new MlsSessionError("no-key-package", "no KeyPackage available to create the group");
    }
    await state.engine.createGroup(channelGroupId(channel.id), createKeyPackage);
    state.pendingWelcomeKeyPackage = undefined;
    state.groupKeyPackage = createKeyPackage;
    state.groupId = encodeMlsBytes(channelGroupId(channel.id));
    const epoch = Number(await state.engine.epoch());
    const initialState = await state.engine.exportState();
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

  private async hasLocalGroup(state: ChannelState): Promise<boolean> {
    try {
      await state.engine.members();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves `true` when the Welcome subscription joins this device, `false`
   * when `timeoutMs` elapses first (or immediately when it is `0`).
   */
  private waitForWelcome(
    channelId: string,
    state: ChannelState,
    timeoutMs: number,
  ): Promise<boolean> {
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
      if (timeoutMs <= 0) {
        queueMicrotask(() => finish(false));
        return;
      }
      setTimeout(() => finish(false), timeoutMs);
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
          await state.engine.joinFromWelcome(
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
    // A creator's group starts at epoch 0, before anyone has been added, so an
    // epoch of 0 is a valid approval candidate. Only an already-joined group
    // can service intents, and `state.ready` above guarantees that.
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
      result = await state.engine.addMembers(keyPackages);
    } catch {
      return;
    }
    const epoch = Number(await state.engine.epoch());
    await this.port.appendCommit({
      channelId: state.channelId,
      epoch,
      commitCiphertext: encodeMlsBytes(result.commit),
      welcomeCiphertext: encodeMlsBytes(result.welcome),
    });
    for (const intent of accepted) {
      await this.port.markJoinIntentServiced({ intentId: intent.id });
    }
    // Re-encrypt the channel name at the new epoch so the devices that just
    // joined (and could not read the pre-join ciphertext) can read it.
    await this.publishChannelName(state);
  }

  /** Applies incoming handshake commits after the local epoch. */
  async applyCommits(state: ChannelState, commits: readonly MlsCommitRow[]): Promise<void> {
    if (!state.ready) {
      return;
    }
    let local: bigint;
    try {
      local = await state.engine.epoch();
    } catch {
      return;
    }
    const pending = [...commits]
      .filter((commit) => BigInt(commit.epoch) > local)
      .sort((a, b) => a.epoch - b.epoch);
    for (const commit of pending) {
      try {
        await state.engine.processCommit(decodeMlsBytes(commit.commitCiphertext));
      } catch {
        // A commit we cannot process (already applied, or not for us) is
        // skipped; the epoch guard above keeps this bounded.
      }
    }
    // If another member advanced the epoch, re-publish the name so the new
    // group can read it (and so a removed member cannot read later rewrites).
    let advanced = false;
    try {
      advanced = (await state.engine.epoch()) > local;
    } catch {
      advanced = false;
    }
    if (advanced) {
      await this.publishChannelName(state);
    }
  }

  /** Decrypts an incoming message list and notifies subscribers. */
  async receiveMessages(messages: readonly MessagePayload[]): Promise<void> {
    this.latestMessages = messages;
    for (const message of messages) {
      if (message.deletedAt !== null) {
        continue;
      }
      const engine = this.channels.get(message.channelId)?.engine;
      if (engine === undefined) {
        continue;
      }
      // Skip a message only when we already decrypted this exact ciphertext;
      // an edit produces a new ciphertext for the same id and must be reopened.
      if (this.messageCiphertexts.get(message.id) === message.ciphertext) {
        continue;
      }
      const inFlight = this.decrypting.get(message.id);
      if (inFlight !== undefined) {
        await inFlight;
        continue;
      }
      const task = this.decryptMessage(engine, message);
      this.decrypting.set(message.id, task);
      try {
        await task;
      } finally {
        this.decrypting.delete(message.id);
      }
    }
    for (const listener of this.messageListeners) {
      listener(messages);
    }
    for (const listener of this.decryptedListeners) {
      listener(messages);
    }
  }

  /**
   * Opens one message's ciphertext once and records the plaintext. A failure
   * (history before this device joined, or a message not addressed to it) is
   * swallowed so the list renders rather than throwing.
   */
  private async decryptMessage(engine: MlsEngine, message: MessagePayload): Promise<void> {
    try {
      const bytes = await engine.decrypt(decodeMlsBytes(message.ciphertext));
      this.decrypted.set(message.id, decodePayload<MessagePayloadBody>(bytes).t);
      this.messageCiphertexts.set(message.id, message.ciphertext);
    } catch (error) {
      if (error instanceof MlsEngineError || error instanceof Error) {
        return;
      }
      throw error;
    }
  }

  /** Decrypted plaintext for a message id, or `undefined` if not openable. */
  decryptedText(messageId: string): string | undefined {
    return this.decrypted.get(messageId);
  }

  /**
   * Encrypts an arbitrary JSON payload at the channel's current epoch. The
   * plaintext is cached under the produced ciphertext because MLS ratchets make
   * a sender unable to reopen its own application message.
   */
  async encryptPayload(channelId: string, payload: unknown): Promise<string> {
    const state = this.requireGroup(channelId);
    const ciphertext = encodeMlsBytes(await state.engine.encrypt(encodePayload(payload)));
    this.selfPayloads.set(ciphertext, payload);
    return ciphertext;
  }

  /**
   * Encrypts and publishes a channel's name, remembering the plaintext so it
   * can be re-encrypted at a later epoch. A device that joins after the name
   * was first written cannot read that earlier ciphertext (MLS forward
   * secrecy), so every membership change re-publishes the name at the new
   * epoch for the current members.
   */
  async setChannelName(channelId: string, name: string): Promise<void> {
    const state = this.requireGroup(channelId);
    state.name = name;
    state.nameEpoch = undefined;
    await this.publishChannelName(state);
  }

  private async publishChannelName(state: ChannelState): Promise<void> {
    if (state.name === undefined) {
      return;
    }
    const epoch = Number(await state.engine.epoch());
    if (state.nameEpoch === epoch) {
      return;
    }
    const ciphertext = encodeMlsBytes(
      await state.engine.encrypt(encodePayload({ text: state.name })),
    );
    this.selfPayloads.set(ciphertext, { text: state.name });
    await this.port.renameChannel({ channelId: state.channelId, nameCiphertext: ciphertext });
    state.nameEpoch = epoch;
  }

  /**
   * Decrypts an arbitrary payload (channel name, topic, custom status) using
   * the given channel's group. Payloads this device produced are served from
   * the local cache. Returns `undefined` instead of throwing when the payload
   * is not openable.
   */
  async decryptPayload<T>(channelId: string, ciphertext: string): Promise<T | undefined> {
    const cached = this.selfPayloads.get(ciphertext) ?? this.payloadCache.get(ciphertext);
    if (cached !== undefined) {
      return cached as T;
    }
    const state = this.channels.get(channelId);
    if (state === undefined || !state.ready) {
      return undefined;
    }
    try {
      const bytes = await state.engine.decrypt(decodeMlsBytes(ciphertext));
      const decoded = decodePayload<T>(bytes);
      this.payloadCache.set(ciphertext, decoded);
      return decoded;
    } catch {
      return undefined;
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
    const epoch = Number(await state.engine.epoch());
    const body: MessagePayloadBody = options.threadRootId
      ? { t: text, threadRootId: options.threadRootId }
      : { t: text };
    const ciphertext = encodeMlsBytes(await state.engine.encrypt(encodePayload(body)));
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
    this.messageCiphertexts.set(messageId, ciphertext);
    await this.port.clearTyping({ channelId });
    void state;
    return messageId;
  }

  /** Edits a message with a fresh encryption at the current epoch. */
  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    const state = this.requireGroup(channelId);
    const existing = this.latestMessages.find((message) => message.id === messageId);
    const epoch = Number(await state.engine.epoch());
    const body: MessagePayloadBody = {
      t: text,
      edited: true,
      ...(existing?.threadRootId ? { threadRootId: existing.threadRootId } : {}),
    };
    const ciphertext = encodeMlsBytes(await state.engine.encrypt(encodePayload(body)));
    await this.port.editMessage({ messageId, ciphertext, epoch });
    this.decrypted.set(messageId, text);
    this.messageCiphertexts.set(messageId, ciphertext);
  }

  /** Soft-deletes a message and drops its local plaintext. */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.requireGroup(channelId);
    await this.port.deleteMessage({ messageId });
    this.decrypted.delete(messageId);
    this.messageCiphertexts.delete(messageId);
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
    const state = this.requireGroup(channelId);
    const emojiCiphertext = encodeMlsBytes(await state.engine.encrypt(encodeText(emoji)));
    this.selfPayloads.set(emojiCiphertext, { text: emoji });
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
    channelId: string,
    rows: readonly ReactionRow[],
  ): Promise<ReactionPayload[]> {
    const state = this.channels.get(channelId);
    if (state === undefined || !state.ready) {
      return [];
    }
    const resolved: ReactionPayload[] = [];
    for (const row of rows) {
      const cached =
        this.selfPayloads.get(row.emojiCiphertext) ?? this.payloadCache.get(row.emojiCiphertext);
      if (cached !== undefined) {
        resolved.push({
          userId: row.userId,
          emoji: (cached as { text: string }).text,
          emojiCiphertext: row.emojiCiphertext,
        });
        continue;
      }
      try {
        const bytes = await state.engine.decrypt(decodeMlsBytes(row.emojiCiphertext));
        const emoji = decodePayload<{ text: string }>(bytes).text;
        this.payloadCache.set(row.emojiCiphertext, { text: emoji });
        resolved.push({
          userId: row.userId,
          emoji,
          emojiCiphertext: row.emojiCiphertext,
        });
      } catch {}
    }
    return resolved;
  }

  /** Decrypts and groups the reactions on a message, emitting the result. */
  async loadReactions(
    channelId: string,
    messageId: string,
    rows: readonly ReactionRow[],
  ): Promise<ReactionPayload[]> {
    const resolved = await this.decryptReactions(channelId, rows);
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
    return await this.requireGroup(channelId).engine.members();
  }

  /** Current local MLS epoch for a channel. */
  async epoch(channelId: string): Promise<number> {
    return Number(await this.requireGroup(channelId).engine.epoch());
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

  /** Exposes the channel engine so callers can decrypt channel-scoped payloads. */
  engineFor(channelId: string): MlsEngine | undefined {
    return this.channels.get(channelId)?.engine;
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
