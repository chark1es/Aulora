/**
 * Test doubles for the chat session.
 *
 * `createMockPort()` is an in-memory `ChatPort` plus subscription plumbing that
 * stores plaintext rows and emits watch callbacks, so session behaviour can be
 * tested without a backend.
 */

import { type Overwrite, Permission } from "../permissions.js";
import { createMockHub, type MockPortState } from "./mock-hub.js";
import type { ChatPort, ChatSubscriptions, StoredFileView } from "./port.js";

export type { MockPortState } from "./mock-hub.js";

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
export function createMockPort(options: { readonly now?: () => number } = {}): MockPort {
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
  const hub = createMockHub(state);

  const record = (method: string, args: unknown) => {
    state.calls.push({ method, args });
  };

  const sendMessage = (args: {
    channelId: string;
    body: string;
    threadRootId?: string;
    replyToId?: string;
    mentionUserIds?: readonly string[];
    mentionChannelIds?: readonly string[];
    mentionCategoryIds?: readonly string[];
    attachmentIds?: readonly string[];
  }): Promise<string> => {
    record("sendMessage", args);
    messageSeq += 1;
    const createdAt = options.now?.() ?? messageSeq;
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
      ...(args.mentionChannelIds !== undefined
        ? { mentionChannelIds: [...args.mentionChannelIds] }
        : {}),
      ...(args.mentionCategoryIds !== undefined
        ? { mentionCategoryIds: [...args.mentionCategoryIds] }
        : {}),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      createdAt,
    });
    if (args.threadRootId !== undefined) {
      const root = state.messages.get(args.threadRootId);
      if (root !== undefined) {
        state.messages.set(root.id, {
          ...root,
          replyCount: (root.replyCount ?? 0) + 1,
          lastReplyAt: createdAt,
        });
      }
    }
    hub.emitMessages(args.channelId);
    return Promise.resolve(id);
  };

  const port: MockPort = {
    state,
    ...hub.subscriptions,
    upsertDevice(args) {
      record("upsertDevice", args);
      return Promise.resolve({ deviceId: state.deviceId });
    },
    createChannel(args) {
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
      hub.emitChannels();
      return Promise.resolve(id);
    },
    reorderChannels(args) {
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
      hub.emitChannels();
      return Promise.resolve(null);
    },
    renameChannel(args) {
      record("renameChannel", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, name: args.name });
        hub.emitChannels();
      }
      return Promise.resolve(null);
    },
    setChannelTopic(args) {
      record("setChannelTopic", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, topic: args.topic ?? null });
        hub.emitChannels();
      }
      return Promise.resolve(null);
    },
    setChannelPrivate(args) {
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
        hub.emitChannels();
      }
      return Promise.resolve(null);
    },
    setChannelBlocked(args) {
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
        hub.emitChannels();
      }
      return Promise.resolve(null);
    },
    joinChannel(args) {
      record("joinChannel", args);
      return Promise.resolve(null);
    },
    leaveChannel(args) {
      record("leaveChannel", args);
      return Promise.resolve(null);
    },
    addChannelMember(args) {
      record("addChannelMember", args);
      const list = state.members.get(args.channelId) ?? [];
      if (list.includes(args.userId)) {
        return Promise.resolve({ added: false });
      }
      state.members.set(args.channelId, [...list, args.userId]);
      return Promise.resolve({ added: true });
    },
    removeChannelMember(args) {
      record("removeChannelMember", args);
      const list = state.members.get(args.channelId) ?? [];
      if (!list.includes(args.userId)) {
        return Promise.resolve({ removed: false });
      }
      state.members.set(
        args.channelId,
        list.filter((id) => id !== args.userId),
      );
      return Promise.resolve({ removed: true });
    },
    archiveChannel(args) {
      record("archiveChannel", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, archived: true });
        hub.emitChannels();
      }
      return Promise.resolve(null);
    },
    unarchiveChannel(args) {
      record("unarchiveChannel", args);
      const channel = state.channels.get(args.channelId);
      if (channel !== undefined) {
        state.channels.set(args.channelId, { ...channel, archived: false });
        hub.emitChannels();
      }
      return Promise.resolve(null);
    },
    createDm(args) {
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
      hub.emitChannels();
      return Promise.resolve({ channelId: id, created: true });
    },
    createGroupDm(args) {
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
      hub.emitChannels();
      return Promise.resolve({ channelId: id, created: true });
    },
    getChannelMemberIds(args) {
      record("getChannelMemberIds", args);
      return Promise.resolve(state.members.get(args.channelId) ?? []);
    },
    uploadFile(args) {
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
      return Promise.resolve(fileId);
    },
    getFile(args) {
      record("getFile", args);
      return Promise.resolve(state.files.get(args.fileId) ?? null);
    },
    getFiles(args) {
      record("getFiles", args);
      return Promise.resolve(
        args.fileIds
          .map((fileId) => state.files.get(fileId))
          .filter((file): file is StoredFileView => file !== undefined),
      );
    },
    downloadFile(args) {
      record("downloadFile", args);
      const bytes = state.blobs.get(args.fileId);
      if (bytes === undefined) {
        return Promise.reject(new Error("file is no longer available"));
      }
      return Promise.resolve(new Uint8Array(bytes));
    },
    sendMessage,
    editMessage(args) {
      record("editMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, {
          ...message,
          body: args.body,
          editedAt: Date.now(),
        });
        hub.emitMessages(message.channelId);
      }
      return Promise.resolve(null);
    },
    deleteMessage(args) {
      record("deleteMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, deletedAt: Date.now() });
        hub.emitMessages(message.channelId);
      }
      return Promise.resolve(null);
    },
    pinMessage(args) {
      record("pinMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, pinnedAt: Date.now() });
        hub.emitMessages(message.channelId);
      }
      return Promise.resolve(null);
    },
    unpinMessage(args) {
      record("unpinMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, pinnedAt: null });
        hub.emitMessages(message.channelId);
      }
      return Promise.resolve(null);
    },
    toggleReaction(args) {
      record("toggleReaction", args);
      const list = state.reactions.get(args.messageId) ?? [];
      const index = list.findIndex(
        (reaction) => reaction.userId === "me" && reaction.emoji === args.emoji,
      );
      const next = [...list];
      if (index >= 0) {
        next.splice(index, 1);
        hub.emitReactions(args.messageId, next);
        return Promise.resolve({ added: false });
      }
      next.push({ id: nextId("reaction"), userId: "me", emoji: args.emoji });
      hub.emitReactions(args.messageId, next);
      return Promise.resolve({ added: true });
    },
    heartbeat(args) {
      record("heartbeat", args);
      return Promise.resolve(null);
    },
    setStatus(args) {
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
      hub.emitPresence();
      return Promise.resolve(null);
    },
    setTyping(args) {
      record("setTyping", args);
      const list = state.typing.get(args.channelId) ?? [];
      const next = [
        ...list.filter((row) => row.userId !== "me"),
        { userId: "me", expiresAt: Date.now() + 8000 },
      ];
      state.typing.set(args.channelId, next);
      hub.emitTyping(args.channelId);
      return Promise.resolve({ expiresAt: next.at(-1)?.expiresAt ?? 0 });
    },
    clearTyping(args) {
      record("clearTyping", args);
      state.typing.set(
        args.channelId,
        (state.typing.get(args.channelId) ?? []).filter((row) => row.userId !== "me"),
      );
      hub.emitTyping(args.channelId);
      return Promise.resolve(null);
    },
    setReadState(args) {
      record("setReadState", args);
      const next = {
        channelId: args.channelId,
        lastReadMessageId: args.lastReadMessageId,
        mentionCount: 0,
      };
      state.readStates.set(args.channelId, next);
      hub.emitReadState(args.channelId, next);
      return Promise.resolve(null);
    },
  };

  return port;
}
