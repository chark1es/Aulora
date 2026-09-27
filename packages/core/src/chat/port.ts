/**
 * The Convex-facing surface the Aulora chat session depends on.
 *
 * These types are structural: the real implementation is a thin wrapper around
 * a live `ConvexReactClient` (in `apps/web`), while the session tests inject a
 * simple mock. Keeping the port here means `@aulora/core` stays Convex-agnostic
 * and every session behaviour is unit-testable without a backend.
 *
 * Everything crossing this boundary is plaintext. The server seals content at
 * rest with its External Key Manager; the client never sees a key or an
 * encrypted envelope. Ids are opaque strings: `@aulora/core` never imports
 * Convex `Id<>` types.
 */
import type { Overwrite } from "../permissions";

export interface AttachmentDimensions {
  readonly width: number;
  readonly height: number;
}

/** A small image preview of an attachment. */
export interface AttachmentThumbnail {
  readonly fileId: string;
  readonly width: number;
  readonly height: number;
  readonly blurhash?: string;
}

/**
 * Plaintext attachment reference embedded in a message body. The server stores
 * the bytes sealed; `fileId` is all the message row carries.
 */
export interface AttachmentDescriptor {
  readonly fileId: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly dimensions?: AttachmentDimensions;
  readonly blurhash?: string;
  readonly thumbnail?: AttachmentThumbnail;
}

/** What the server sends for every message. `body` is already plaintext. */
export interface MessagePayload {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly body: string;
  readonly threadRootId: string | null;
  /** The message this one is a quoted inline reply to, if any. */
  readonly replyToId?: string | null;
  readonly attachmentIds: readonly string[];
  readonly mentionUserIds: readonly string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly pinnedAt: number | null;
  /** Thread roots: number of replies (absent on older servers and replies). */
  readonly replyCount?: number;
  /** Thread roots: creation time of the newest reply. */
  readonly lastReplyAt?: number | null;
  readonly createdAt: number;
}

export interface ChannelSummary {
  readonly id: string;
  readonly kind: "text" | "announcement" | "dm" | "group_dm";
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly topic: string | null;
  readonly archived: boolean;
  /** A private channel: membership, not the permission bitfield, decides access. */
  readonly isPrivate?: boolean;
  /** Present when the server includes the channel's own overrides. */
  readonly overrides?: readonly Overwrite[];
  /** Display order within its category; falls back to creation order when unset. */
  readonly position?: number;
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

export interface ReactionRow {
  readonly id: string;
  readonly userId: string;
  readonly emoji: string;
}

export interface PresenceRow {
  readonly userId: string;
  readonly status: "online" | "idle" | "dnd" | "offline";
  readonly customStatus: string | null;
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
  readonly lastSeen: number;
}

/**
 * Plaintext file metadata as stored server-side. `dimensions` is the decoded
 * `{"width":…,"height":…}` JSON string the uploader recorded; `url` is a
 * short-lived link that yields the decrypted bytes.
 */
export interface StoredFileView {
  readonly id: string;
  readonly uploaderId: string;
  readonly sizeBytes: number;
  readonly name: string | null;
  readonly mime: string | null;
  readonly dimensions: string | null;
  readonly blurhash: string | null;
  readonly url: string | null;
}

/**
 * Imperative reads and writes against one workspace. Plaintext in, plaintext
 * out; the session never logs content or tokens.
 */
export interface ChatPort {
  // Devices.
  upsertDevice(args: { platform: string; pushToken?: string }): Promise<{ deviceId: string }>;

  // Channels.
  createChannel(args: {
    kind: "text" | "announcement";
    name: string;
    topic?: string;
    categoryId?: string;
    private?: boolean;
    /** Private channels only: explicit members to add and grant access. */
    memberIds?: readonly string[];
    /** Private channels only: roles whose members are added and granted access. */
    roleIds?: readonly string[];
  }): Promise<string>;
  /** Applies drag-and-drop moves; `categoryId` `null` means uncategorised. */
  reorderChannels(args: {
    readonly moves: readonly {
      readonly channelId: string;
      readonly categoryId?: string | null;
      readonly position: number;
    }[];
  }): Promise<null>;
  renameChannel(args: { channelId: string; name: string }): Promise<null>;
  setChannelTopic(args: { channelId: string; topic?: string }): Promise<null>;
  joinChannel(args: { channelId: string }): Promise<null>;
  leaveChannel(args: { channelId: string }): Promise<null>;
  addChannelMember(args: { channelId: string; userId: string }): Promise<{ added: boolean }>;
  removeChannelMember(args: { channelId: string; userId: string }): Promise<{ removed: boolean }>;
  archiveChannel(args: { channelId: string }): Promise<null>;
  unarchiveChannel(args: { channelId: string }): Promise<null>;
  createDm(args: { otherUserId: string }): Promise<{ channelId: string; created: boolean }>;
  createGroupDm(args: {
    memberIds: readonly string[];
  }): Promise<{ channelId: string; created: boolean }>;
  getChannelMemberIds(args: { channelId: string }): Promise<readonly string[]>;

  // Files. Plaintext in; the server seals the bytes and metadata at rest.
  /** Uploads plaintext to a generated URL, finalizes it, and returns the `files` id. */
  uploadFile(args: {
    name: string;
    mime: string;
    bytes: Uint8Array;
    dimensions?: AttachmentDimensions;
    blurhash?: string;
    channelId?: string;
  }): Promise<string>;
  getFile(args: { fileId: string }): Promise<StoredFileView | null>;
  getFiles(args: { fileIds: readonly string[] }): Promise<readonly StoredFileView[]>;
  /** Downloads the decrypted bytes for a file via its signed `url`. */
  downloadFile(args: { fileId: string }): Promise<Uint8Array>;

  // Messages.
  sendMessage(args: {
    channelId: string;
    body: string;
    threadRootId?: string;
    replyToId?: string;
    mentionUserIds?: readonly string[];
    attachmentIds?: readonly string[];
  }): Promise<string>;
  editMessage(args: { messageId: string; body: string }): Promise<null>;
  deleteMessage(args: { messageId: string }): Promise<null>;
  pinMessage(args: { messageId: string }): Promise<null>;
  unpinMessage(args: { messageId: string }): Promise<null>;
  toggleReaction(args: { messageId: string; emoji: string }): Promise<{ added: boolean }>;

  // Presence / typing / read state.
  heartbeat(args: { status?: "online" | "idle" | "dnd" }): Promise<unknown>;
  setStatus(args: {
    status: "online" | "idle" | "dnd" | "offline";
    customStatus?: string;
  }): Promise<unknown>;
  setTyping(args: { channelId: string }): Promise<{ expiresAt: number }>;
  clearTyping(args: { channelId: string }): Promise<null>;
  setReadState(args: { channelId: string; lastReadMessageId: string }): Promise<unknown>;
}

/** Live subscriptions for a channel list / conversation. Returns an unsubscribe. */
export interface ChatSubscriptions {
  /** Live channels visible to the signed-in member. */
  watchChannels(onChange: (channels: readonly ChannelSummary[]) => void): () => void;
  /**
   * Live root messages for a channel, oldest first: the newest `limit` roots
   * (the adapter's default page when omitted). Raising `limit` loads older
   * history while the live tail keeps updating.
   */
  watchMessages(
    channelId: string,
    onChange: (messages: readonly MessagePayload[]) => void,
    options?: { readonly limit?: number },
  ): () => void;
  /** Live reactions for one message. */
  watchReactions(
    messageId: string,
    onChange: (reactions: readonly ReactionRow[]) => void,
  ): () => void;
  /** Live presence for the workspace. */
  watchPresence(onChange: (presence: readonly PresenceRow[]) => void): () => void;
  /** Live typers in a channel. */
  watchTyping(channelId: string, onChange: (typers: readonly TypingRow[]) => void): () => void;
  /** Live read state for the caller in a channel. */
  watchReadState(channelId: string, onChange: (state: ReadStateRow | null) => void): () => void;
}
