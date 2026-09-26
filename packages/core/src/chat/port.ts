/**
 * The Convex-facing surface the Aulora chat session depends on.
 *
 * These types are structural: the real implementation is a thin wrapper around
 * a live `ConvexReactClient` (in `apps/web`), while the session tests inject a
 * simple mock. Keeping the port here means `@aulora/core` stays Convex-agnostic
 * and every session behaviour is unit-testable without a backend.
 *
 * Ids are opaque strings: `@aulora/core` never imports Convex `Id<>` types.
 */

/** What the server sends for every message. `ciphertext` is opaque. */
export interface MessagePayload {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly authorDeviceId: string | null;
  readonly ciphertext: string;
  readonly epoch: number;
  readonly threadRootId: string | null;
  readonly attachmentIds: readonly string[];
  readonly mentionUserIds: readonly string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly pinnedAt: number | null;
  readonly createdAt: number;
}

export interface ChannelSummary {
  readonly id: string;
  readonly kind: "text" | "announcement" | "dm" | "group_dm";
  readonly categoryId: string | null;
  readonly nameCiphertext: string | null;
  readonly topicCiphertext: string | null;
  readonly mlsGroupId: string | null;
  readonly archived: boolean;
  readonly currentEpoch: number | null;
  readonly memberIds?: readonly string[];
}

export interface Paginated<T> {
  readonly page: readonly T[];
  readonly isDone: boolean;
  readonly continueCursor: string;
}

export interface ChannelMemberRow {
  readonly channelId: string;
  readonly userId: string;
  readonly joinedAt: number;
}

export interface MlsCommitRow {
  readonly id: string;
  readonly epoch: number;
  readonly commitCiphertext: string;
  readonly welcomeCiphertext: string | null;
}

export interface JoinIntentRow {
  readonly id: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly keyPackage: string;
  readonly createdAt: number;
}

export interface ReactionRow {
  readonly id: string;
  readonly userId: string;
  readonly emojiCiphertext: string;
}

export interface PresenceRow {
  readonly userId: string;
  readonly status: "online" | "idle" | "dnd" | "offline";
  readonly customStatusCiphertext: string | null;
  readonly lastHeartbeat: number;
}

export interface TypingRow {
  readonly userId: string;
  readonly expiresAt: number;
}

export interface ReadStateRow {
  readonly channelId: string;
  readonly lastReadMessageId: string | null;
  readonly mentionCount: number;
}

export interface DeviceRow {
  readonly id: string;
  readonly platform: string;
  readonly identityKey: string;
  readonly lastSeen: number;
}

/**
 * Imperative reads and writes against one workspace. Secrets in, ciphertext
 * out; the session never logs either.
 */
export interface ChatPort {
  // Devices.
  upsertDevice(args: {
    platform: string;
    identityKey: string;
    pushToken?: string;
  }): Promise<{ deviceId: string }>;

  // Key material.
  publishKeyPackage(args: { deviceId: string; keyPackage: string }): Promise<string>;
  consumeKeyPackages(args: { deviceId: string; count: number }): Promise<readonly string[]>;

  // Channels.
  createChannel(args: {
    kind: "text" | "announcement";
    nameCiphertext: string;
    topicCiphertext?: string;
    mlsGroupId: string;
    categoryId?: string;
  }): Promise<string>;
  setMlsGroupId(args: { channelId: string; mlsGroupId: string }): Promise<null>;
  joinChannel(args: { channelId: string }): Promise<null>;
  leaveChannel(args: { channelId: string }): Promise<null>;
  createDm(args: { otherUserId: string; mlsGroupId?: string }): Promise<{
    channelId: string;
    created: boolean;
  }>;
  createGroupDm(args: { memberIds: readonly string[]; mlsGroupId?: string }): Promise<{
    channelId: string;
    created: boolean;
  }>;
  getChannelMemberIds(args: { channelId: string }): Promise<readonly string[]>;

  // MLS.
  appendCommit(args: {
    channelId: string;
    epoch: number;
    commitCiphertext: string;
    welcomeCiphertext?: string;
  }): Promise<string>;
  publishJoinIntent(args: {
    channelId: string;
    deviceId: string;
    keyPackage: string;
  }): Promise<string>;
  markJoinIntentServiced(args: { intentId: string }): Promise<null>;

  // Messages.
  sendMessage(args: {
    channelId: string;
    ciphertext: string;
    epoch: number;
    threadRootId?: string;
    mentionUserIds?: readonly string[];
    attachmentIds?: readonly string[];
    authorDeviceId?: string;
  }): Promise<string>;
  editMessage(args: { messageId: string; ciphertext: string; epoch: number }): Promise<null>;
  deleteMessage(args: { messageId: string }): Promise<null>;
  pinMessage(args: { messageId: string }): Promise<null>;
  unpinMessage(args: { messageId: string }): Promise<null>;
  toggleReaction(args: { messageId: string; emojiCiphertext: string }): Promise<{ added: boolean }>;

  // Presence / typing / read state.
  heartbeat(args: { status?: "online" | "idle" | "dnd" }): Promise<unknown>;
  setStatus(args: {
    status: "online" | "idle" | "dnd" | "offline";
    customStatusCiphertext?: string;
  }): Promise<unknown>;
  setTyping(args: { channelId: string }): Promise<{ expiresAt: number }>;
  clearTyping(args: { channelId: string }): Promise<null>;
  setReadState(args: { channelId: string; lastReadMessageId: string }): Promise<unknown>;
}

/** Live subscriptions for a channel list / conversation. Returns an unsubscribe. */
export interface ChatSubscriptions {
  /** Live channels visible to the signed-in member. */
  watchChannels(onChange: (channels: readonly ChannelSummary[]) => void): () => void;
  /** Live root messages for a channel, oldest first. */
  watchMessages(
    channelId: string,
    onChange: (messages: readonly MessagePayload[]) => void,
  ): () => void;
  /** Live reactions for one message. */
  watchReactions(
    messageId: string,
    onChange: (reactions: readonly ReactionRow[]) => void,
  ): () => void;
  /** Live MLS commits after a given epoch. */
  watchCommits(
    channelId: string,
    afterEpoch: number,
    onChange: (commits: readonly MlsCommitRow[]) => void,
  ): () => void;
  /** Live unserviced join intents for a channel. */
  watchJoinIntents(
    channelId: string,
    onChange: (intents: readonly JoinIntentRow[]) => void,
  ): () => void;
  /** Live presence for the workspace. */
  watchPresence(onChange: (presence: readonly PresenceRow[]) => void): () => void;
  /** Live typers in a channel. */
  watchTyping(channelId: string, onChange: (typers: readonly TypingRow[]) => void): () => void;
  /** Live read state for the caller in a channel. */
  watchReadState(channelId: string, onChange: (state: ReadStateRow | null) => void): () => void;
}
