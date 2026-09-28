/**
 * Test doubles for the chat session.
 *
 * `createMockPort()` is an in-memory `ChatPort` plus subscription plumbing that
 * stores plaintext rows and emits watch callbacks, so session behaviour can be
 * tested without a backend. `createMemoryMlsEngine()` is a no-op stub kept only
 * for the dev preview, which still wires an engine factory at construction time
 * even though MLS is gone and the server now seals content.
 */

import { type Overwrite, Permission } from "../permissions.js";
import type {
  ChannelSummary,
  ChatPort,
  ChatSubscriptions,
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  StoredFileView,
  TypingRow,
} from "./port.js";

export interface MockPortState {
  readonly calls: { method: string; args: unknown }[];
  readonly channels: Map<string, ChannelSummary>;
  readonly messages: Map<string, MessagePayload>;
  readonly reactions: Map<string, ReactionRow[]>;
  readonly presence: PresenceRow[];
  readonly typing: Map<string, TypingRow[]>;
  readonly readStates: Map<string, ReadStateRow>;
  readonly members: Map<string, string[]>;
  readonly files: Map<string, StoredFileView>;
  /** Plaintext bytes by file id (the mock's "sealed at rest" storage). */
  readonly blobs: Map<string, Uint8Array>;
  deviceId: string;
}

export interface MockPort extends ChatPort, ChatSubscriptions {
  readonly state: MockPortState;
}

let messageSeq = 0;
let entitySeq = 0;

function nextId(prefix: string): string {
  entitySeq += 1;
  return `${prefix}-${entitySeq}`;
}

/**
 * In-memory {@link ChatPort} + {@link ChatSubscriptions}. Writes are recorded
 * and observable through the watch callbacks, so hooks can be exercised in
 * tests without Convex.
 */
export function createMockPort(): MockPort {
  const state: MockPortState = {
    calls: [],
    channels: new Map(),
    messages: new Map(),
    reactions: new Map(),
    presence: [],
    typing: new Map(),
    readStates: new Map(),
    members: new Map(),
    files: new Map(),
    blobs: new Map(),
    deviceId: "device-1",
  };

  const channelListeners: ((channels: readonly ChannelSummary[]) => void)[] = [];
  const messageListeners = new Map<string, ((m: readonly MessagePayload[]) => void)[]>();
  const reactionListeners = new Map<string, ((r: readonly ReactionRow[]) => void)[]>();
  const presenceListeners: ((p: readonly PresenceRow[]) => void)[] = [];
  const typingListeners = new Map<string, ((t: readonly TypingRow[]) => void)[]>();
  const readStateListeners = new Map<string, ((s: ReadStateRow | null) => void)[]>();

  const record = (method: string, args: unknown) => {
    state.calls.push({ method, args });
  };

  const emitChannels = () => {
    const list = [...state.channels.values()];
    for (const listener of channelListeners) {
      listener(list);
    }
  };
  const emitMessages = (channelId: string) => {
    const list = [...state.messages.values()]
      .filter((message) => message.channelId === channelId && message.threadRootId === null)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const listener of messageListeners.get(channelId) ?? []) {
      listener(list);
    }
  };
  const emitTyping = (channelId: string) => {
    for (const listener of typingListeners.get(channelId) ?? []) {
      listener(state.typing.get(channelId) ?? []);
    }
  };

  const port: MockPort = {
    state,
    async upsertDevice(args) {
      record("upsertDevice", args);
      return { deviceId: state.deviceId };
    },
    async createChannel(args) {
      record("createChannel", args);
      const id = nextId("channel");
      state.channels.set(id, {
        id,
        kind: args.kind,
        categoryId: args.categoryId ?? null,
        name: args.name,
        topic: args.topic ?? null,
        archived: false,
        ...(args.private === true ? { isPrivate: true } : {}),
      });
      state.members.set(id, args.private === true ? ["me"] : []);
      emitChannels();
      return id;
    },
    async reorderChannels(args) {
      record("reorderChannels", args);
      for (const move of args.moves) {
        const channel = state.channels.get(move.channelId);
        if (channel !== undefined) {
          state.channels.set(move.channelId, {
            ...channel,
            position: move.position,
            ...(move.categoryId !== undefined ? { categoryId: move.categoryId } : {}),
          });
        }
      }
      emitChannels();
      return null;
    },
    async renameChannel(args) {
      record("renameChannel", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, name: args.name });
        emitChannels();
      }
      return null;
    },
    async setChannelTopic(args) {
      record("setChannelTopic", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, topic: args.topic ?? null });
        emitChannels();
      }
      return null;
    },
    async setChannelPrivate(args) {
      record("setChannelPrivate", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        const memberIds = args.private ? [...new Set(["me", ...(args.memberIds ?? [])])] : [];
        state.members.set(args.channelId, memberIds);
        state.channels.set(args.channelId, {
          ...channel,
          isPrivate: args.private,
          memberIds,
        });
        emitChannels();
      }
      return null;
    },
    async setChannelBlocked(args) {
      record("setChannelBlocked", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        const blocked = new Set(args.userIds);
        const overrides: Overwrite[] = (channel.overrides ?? []).filter(
          (override) => override.targetType !== "member" || !blocked.has(override.targetId),
        );
        for (const userId of blocked) {
          overrides.push({
            targetId: userId,
            targetType: "member",
            allow: 0n,
            deny: Permission.ViewChannel,
          });
        }
        state.channels.set(args.channelId, {
          ...channel,
          overrides,
          memberIds: (channel.memberIds ?? []).filter((id) => !blocked.has(id)),
        });
        emitChannels();
      }
      return null;
    },
    async joinChannel(args) {
      record("joinChannel", args);
      return null;
    },
    async leaveChannel(args) {
      record("leaveChannel", args);
      return null;
    },
    async addChannelMember(args) {
      record("addChannelMember", args);
      const list = state.members.get(args.channelId) ?? [];
      if (list.includes(args.userId)) {
        return { added: false };
      }
      state.members.set(args.channelId, [...list, args.userId]);
      return { added: true };
    },
    async removeChannelMember(args) {
      record("removeChannelMember", args);
      const list = state.members.get(args.channelId) ?? [];
      if (!list.includes(args.userId)) {
        return { removed: false };
      }
      state.members.set(
        args.channelId,
        list.filter((id) => id !== args.userId),
      );
      return { removed: true };
    },
    async archiveChannel(args) {
      record("archiveChannel", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, archived: true });
        emitChannels();
      }
      return null;
    },
    async unarchiveChannel(args) {
      record("unarchiveChannel", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, archived: false });
        emitChannels();
      }
      return null;
    },
    async createDm(args) {
      record("createDm", args);
      const id = nextId("channel");
      state.channels.set(id, {
        id,
        kind: "dm",
        categoryId: null,
        name: null,
        topic: null,
        archived: false,
        memberIds: ["me", args.otherUserId],
      });
      state.members.set(id, ["me", args.otherUserId]);
      emitChannels();
      return { channelId: id, created: true };
    },
    async createGroupDm(args) {
      record("createGroupDm", args);
      const id = nextId("channel");
      state.channels.set(id, {
        id,
        kind: "group_dm",
        categoryId: null,
        name: null,
        topic: null,
        archived: false,
        memberIds: ["me", ...args.memberIds],
      });
      state.members.set(id, ["me", ...args.memberIds]);
      emitChannels();
      return { channelId: id, created: true };
    },
    async getChannelMemberIds(args) {
      record("getChannelMemberIds", args);
      return state.members.get(args.channelId) ?? [];
    },
    async uploadFile(args) {
      record("uploadFile", { ...args, bytes: args.bytes.length });
      const fileId = nextId("file");
      state.blobs.set(fileId, new Uint8Array(args.bytes));
      state.files.set(fileId, {
        id: fileId,
        uploaderId: "me",
        sizeBytes: args.bytes.length,
        name: args.name,
        mime: args.mime,
        dimensions: args.dimensions !== undefined ? JSON.stringify(args.dimensions) : null,
        blurhash: args.blurhash ?? null,
        url: `blob://${fileId}`,
      });
      return fileId;
    },
    async getFile(args) {
      record("getFile", args);
      return state.files.get(args.fileId) ?? null;
    },
    async getFiles(args) {
      record("getFiles", args);
      return args.fileIds
        .map((fileId) => state.files.get(fileId))
        .filter((file): file is StoredFileView => file !== undefined);
    },
    async downloadFile(args) {
      record("downloadFile", args);
      const bytes = state.blobs.get(args.fileId);
      if (bytes === undefined) {
        throw new Error("file is no longer available");
      }
      return new Uint8Array(bytes);
    },
    async sendMessage(args) {
      record("sendMessage", args);
      messageSeq += 1;
      const id = nextId("message");
      state.messages.set(id, {
        id,
        channelId: args.channelId,
        authorId: "me",
        body: args.body,
        threadRootId: args.threadRootId ?? null,
        ...(args.replyToId !== undefined ? { replyToId: args.replyToId } : {}),
        attachmentIds: [...(args.attachmentIds ?? [])],
        mentionUserIds: [...(args.mentionUserIds ?? [])],
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        createdAt: messageSeq,
      });
      if (args.threadRootId !== undefined) {
        const root = state.messages.get(args.threadRootId);
        if (root !== undefined) {
          state.messages.set(root.id, {
            ...root,
            replyCount: (root.replyCount ?? 0) + 1,
            lastReplyAt: messageSeq,
          });
        }
      }
      emitMessages(args.channelId);
      return id;
    },
    async editMessage(args) {
      record("editMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, {
          ...message,
          body: args.body,
          editedAt: Date.now(),
        });
        emitMessages(message.channelId);
      }
      return null;
    },
    async deleteMessage(args) {
      record("deleteMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, deletedAt: Date.now() });
        emitMessages(message.channelId);
      }
      return null;
    },
    async pinMessage(args) {
      record("pinMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, pinnedAt: Date.now() });
        emitMessages(message.channelId);
      }
      return null;
    },
    async unpinMessage(args) {
      record("unpinMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, pinnedAt: null });
        emitMessages(message.channelId);
      }
      return null;
    },
    async toggleReaction(args) {
      record("toggleReaction", args);
      const list = state.reactions.get(args.messageId) ?? [];
      const index = list.findIndex(
        (reaction) => reaction.userId === "me" && reaction.emoji === args.emoji,
      );
      const next = [...list];
      if (index >= 0) {
        next.splice(index, 1);
        state.reactions.set(args.messageId, next);
        for (const listener of reactionListeners.get(args.messageId) ?? []) {
          listener(next);
        }
        return { added: false };
      }
      next.push({ id: nextId("reaction"), userId: "me", emoji: args.emoji });
      state.reactions.set(args.messageId, next);
      for (const listener of reactionListeners.get(args.messageId) ?? []) {
        listener(next);
      }
      return { added: true };
    },
    async heartbeat(args) {
      record("heartbeat", args);
      return null;
    },
    async setStatus(args) {
      record("setStatus", args);
      state.presence.splice(
        0,
        state.presence.length,
        ...state.presence.filter((row) => row.userId !== "me"),
        {
          userId: "me",
          status: args.status,
          customStatus: args.customStatus ?? null,
          lastHeartbeat: Date.now(),
        },
      );
      for (const listener of presenceListeners) {
        listener(state.presence);
      }
      return null;
    },
    async setTyping(args) {
      record("setTyping", args);
      const list = state.typing.get(args.channelId) ?? [];
      const next = [
        ...list.filter((row) => row.userId !== "me"),
        { userId: "me", expiresAt: Date.now() + 8000 },
      ];
      state.typing.set(args.channelId, next);
      emitTyping(args.channelId);
      return { expiresAt: next[next.length - 1]?.expiresAt ?? 0 };
    },
    async clearTyping(args) {
      record("clearTyping", args);
      state.typing.set(
        args.channelId,
        (state.typing.get(args.channelId) ?? []).filter((row) => row.userId !== "me"),
      );
      emitTyping(args.channelId);
      return null;
    },
    async setReadState(args) {
      record("setReadState", args);
      const next: ReadStateRow = {
        channelId: args.channelId,
        lastReadMessageId: args.lastReadMessageId,
        mentionCount: 0,
      };
      state.readStates.set(args.channelId, next);
      for (const listener of readStateListeners.get(args.channelId) ?? []) {
        listener(next);
      }
      return null;
    },
    watchChannels(onChange) {
      channelListeners.push(onChange);
      onChange([...state.channels.values()]);
      return () => {
        const index = channelListeners.indexOf(onChange);
        if (index >= 0) {
          channelListeners.splice(index, 1);
        }
      };
    },
    watchMessages(channelId, onChange, options) {
      // Like the server: the newest `limit` roots, oldest first.
      const limit = options?.limit;
      const listener = (messages: readonly MessagePayload[]) =>
        onChange(limit === undefined ? messages : messages.slice(-limit));
      const list = messageListeners.get(channelId) ?? [];
      list.push(listener);
      messageListeners.set(channelId, list);
      listener(
        [...state.messages.values()]
          .filter((message) => message.channelId === channelId && message.threadRootId === null)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
      return () => {
        messageListeners.set(
          channelId,
          (messageListeners.get(channelId) ?? []).filter((entry) => entry !== listener),
        );
      };
    },
    watchReactions(messageId, onChange) {
      const list = reactionListeners.get(messageId) ?? [];
      list.push(onChange);
      reactionListeners.set(messageId, list);
      onChange(state.reactions.get(messageId) ?? []);
      return () => {
        reactionListeners.set(
          messageId,
          (reactionListeners.get(messageId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchPresence(onChange) {
      presenceListeners.push(onChange);
      onChange(state.presence);
      return () => {
        const index = presenceListeners.indexOf(onChange);
        if (index >= 0) {
          presenceListeners.splice(index, 1);
        }
      };
    },
    watchTyping(channelId, onChange) {
      const list = typingListeners.get(channelId) ?? [];
      list.push(onChange);
      typingListeners.set(channelId, list);
      onChange(state.typing.get(channelId) ?? []);
      return () => {
        typingListeners.set(
          channelId,
          (typingListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchReadState(channelId, onChange) {
      const list = readStateListeners.get(channelId) ?? [];
      list.push(onChange);
      readStateListeners.set(channelId, list);
      onChange(state.readStates.get(channelId) ?? null);
      return () => {
        readStateListeners.set(
          channelId,
          (readStateListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
  };

  return port;
}

/**
 * No-op stand-in for the removed MLS engine factory.
 *
 * MLS is gone: the session no longer takes an engine and the server seals
 * content. This exists only so the dev preview, which still calls
 * `ChatSession.create({ createEngine: () => … })`, keeps compiling until the
 * apps drop their engine wiring.
 *
 * @deprecated The session is encryption-agnostic; the server seals content.
 */
export function createMemoryMlsEngine(_secret = "memory"): Record<string, never> {
  return {};
}
