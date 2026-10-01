import type {
  ChannelSummary,
  ChatPort,
  ChatSubscriptions,
  MessagePayload,
  MessageReactionRow,
  Paginated,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  StoredFileView,
  TypingRow,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";

/**
 * Live Convex adapter for `@aulora/core`'s `ChatPort` + `ChatSubscriptions`.
 *
 * This is the only place the web app maps Convex functions onto the
 * framework-agnostic chat contract, so the session and hooks stay testable and
 * the mobile app can reuse them with its own adapter. Everything crossing this
 * boundary is plaintext: the server seals content at rest and hands plaintext
 * back, so no keys or envelopes ever reach this client.
 */

const PAGE = { numItems: 100, cursor: null } as const;

/** Message ids per reactions batch; matches the server's `listForMessages` cap. */
const REACTION_BATCH_SIZE = 100;

interface ServerChannel {
  readonly id: string;
  readonly kind: ChannelSummary["kind"];
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly topic: string | null;
  readonly archived: boolean;
  readonly isPrivate?: boolean;
  readonly overrides?: readonly {
    targetId: string;
    targetType: "role" | "member";
    allow: bigint;
    deny: bigint;
  }[];
  readonly position?: number;
  readonly memberIds?: readonly string[];
  readonly hidden?: boolean;
  readonly muted?: boolean;
}

function toSummary(channel: ServerChannel): ChannelSummary {
  return {
    id: channel.id,
    kind: channel.kind,
    categoryId: channel.categoryId,
    name: channel.name,
    topic: channel.topic,
    archived: channel.archived,
    ...(channel.isPrivate !== undefined ? { isPrivate: channel.isPrivate } : {}),
    ...(channel.overrides !== undefined ? { overrides: channel.overrides } : {}),
    ...(channel.position !== undefined ? { position: channel.position } : {}),
    ...(channel.memberIds !== undefined ? { memberIds: channel.memberIds } : {}),
    ...(channel.hidden !== undefined ? { hidden: channel.hidden } : {}),
    ...(channel.muted !== undefined ? { muted: channel.muted } : {}),
  };
}

/** Maps a Convex `files` view onto the framework-agnostic stored-file shape. */
function toStoredFile(file: {
  id: string;
  uploaderId: string;
  sizeBytes: number;
  name: string | null;
  mime: string | null;
  dimensions: string | null;
  blurhash: string | null;
  url: string | null;
}): StoredFileView {
  return {
    id: file.id,
    uploaderId: file.uploaderId,
    sizeBytes: file.sizeBytes,
    name: file.name,
    mime: file.mime,
    dimensions: file.dimensions,
    blurhash: file.blurhash,
    url: file.url,
  };
}

/** Imperative side of the chat backend. */
export function convexPort(client: ConvexReactClient): ChatPort {
  return {
    async upsertDevice(args) {
      return await client.mutation(api.devices.upsert, {
        platform: args.platform,
        ...(args.pushToken !== undefined ? { pushToken: args.pushToken } : {}),
      });
    },
    async createChannel(args) {
      return await client.mutation(api.channels.create, {
        kind: args.kind,
        name: args.name,
        ...(args.topic !== undefined ? { topic: args.topic } : {}),
        ...(args.categoryId !== undefined ? { categoryId: args.categoryId as never } : {}),
        ...(args.private === true ? { private: true } : {}),
        ...(args.memberIds !== undefined ? { memberIds: [...args.memberIds] as never[] } : {}),
        ...(args.roleIds !== undefined ? { roleIds: [...args.roleIds] as never[] } : {}),
      });
    },
    async reorderChannels(args) {
      await client.mutation(api.channels.reorder, {
        moves: args.moves.map((move) => ({
          channelId: move.channelId as never,
          position: move.position,
          ...(move.categoryId !== undefined
            ? { categoryId: move.categoryId === null ? null : (move.categoryId as never) }
            : {}),
        })),
      });
      return null;
    },
    async renameChannel(args) {
      await client.mutation(api.channels.rename, {
        channelId: args.channelId as never,
        name: args.name,
      });
      return null;
    },
    async setChannelTopic(args) {
      await client.mutation(api.channels.setTopic, {
        channelId: args.channelId as never,
        ...(args.topic !== undefined ? { topic: args.topic } : {}),
      });
      return null;
    },
    async setChannelPrivate(args) {
      await client.mutation(api.channels.setPrivate, {
        channelId: args.channelId as never,
        private: args.private,
        ...(args.memberIds !== undefined ? { memberIds: [...args.memberIds] } : {}),
      });
      return null;
    },
    async setChannelBlocked(args) {
      await client.mutation(api.channels.setBlockedUsers, {
        channelId: args.channelId as never,
        userIds: [...args.userIds],
      });
      return null;
    },
    async joinChannel(args) {
      await client.mutation(api.channels.join, { channelId: args.channelId as never });
      return null;
    },
    async leaveChannel(args) {
      await client.mutation(api.channels.leave, { channelId: args.channelId as never });
      return null;
    },
    async addChannelMember(args) {
      const result = await client.mutation(api.channels.addMember, {
        channelId: args.channelId as never,
        userId: args.userId,
      });
      return { added: result.added };
    },
    async removeChannelMember(args) {
      const result = await client.mutation(api.channels.removeMember, {
        channelId: args.channelId as never,
        userId: args.userId,
      });
      return { removed: result.removed };
    },
    async archiveChannel(args) {
      await client.mutation(api.channels.archive, { channelId: args.channelId as never });
      return null;
    },
    async unarchiveChannel(args) {
      await client.mutation(api.channels.unarchive, { channelId: args.channelId as never });
      return null;
    },
    async createDm(args) {
      return await client.mutation(api.channels.createDm, { otherUserId: args.otherUserId });
    },
    async createGroupDm(args) {
      return await client.mutation(api.channels.createGroupDm, { memberIds: [...args.memberIds] });
    },
    async getChannelMemberIds(args) {
      const channel = await client.query(api.channels.get, { channelId: args.channelId as never });
      return channel.memberIds ?? [];
    },
    async setChannelHidden(args) {
      await client.mutation(api.notifications.setChannelHidden, {
        channelId: args.channelId as never,
        hidden: args.hidden,
      });
      return null;
    },
    async setChannelMuted(args) {
      await client.mutation(api.notifications.setChannelMuted, {
        channelId: args.channelId as never,
        muted: args.muted,
      });
      return null;
    },
    async uploadFile(args) {
      const uploadUrl = await client.mutation(api.files.generateUploadUrl, {});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": args.mime },
        body: args.bytes as unknown as BodyInit,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }
      const body = (await response.json()) as { storageId?: unknown };
      if (typeof body.storageId !== "string") {
        throw new Error("Upload response did not include a storageId");
      }
      return await client.action(api.files.finalize, {
        storageId: body.storageId as never,
        name: args.name,
        mime: args.mime,
        sizeBytes: args.bytes.length,
        ...(args.dimensions !== undefined ? { dimensions: JSON.stringify(args.dimensions) } : {}),
        ...(args.blurhash !== undefined ? { blurhash: args.blurhash } : {}),
        ...(args.channelId !== undefined ? { channelId: args.channelId as never } : {}),
      });
    },
    async getFile(args) {
      const view = await client.query(api.files.get, { fileId: args.fileId as never });
      return view === null ? null : toStoredFile(view);
    },
    async getFiles(args) {
      const views = await client.query(api.files.getMany, {
        fileIds: args.fileIds as never[],
      });
      return views.map(toStoredFile);
    },
    async downloadFile(args) {
      const view = await client.query(api.files.get, { fileId: args.fileId as never });
      const url = view?.url ?? null;
      if (url === null) {
        throw new Error("File is no longer available");
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async sendMessage(args) {
      return await client.mutation(api.messages.send, {
        channelId: args.channelId as never,
        body: args.body,
        ...(args.threadRootId !== undefined ? { threadRootId: args.threadRootId as never } : {}),
        ...(args.replyToId !== undefined ? { replyToId: args.replyToId as never } : {}),
        ...(args.mentionUserIds !== undefined ? { mentionUserIds: [...args.mentionUserIds] } : {}),
        ...(args.attachmentIds !== undefined
          ? { attachmentIds: [...args.attachmentIds] as never[] }
          : {}),
      });
    },
    async editMessage(args) {
      await client.mutation(api.messages.edit, {
        messageId: args.messageId as never,
        body: args.body,
      });
      return null;
    },
    async deleteMessage(args) {
      await client.mutation(api.messages.remove, { messageId: args.messageId as never });
      return null;
    },
    async pinMessage(args) {
      await client.mutation(api.messages.pin, { messageId: args.messageId as never });
      return null;
    },
    async unpinMessage(args) {
      await client.mutation(api.messages.unpin, { messageId: args.messageId as never });
      return null;
    },
    async toggleReaction(args) {
      return await client.mutation(api.reactions.toggle, {
        messageId: args.messageId as never,
        emoji: args.emoji,
      });
    },
    async heartbeat(args) {
      return await client.mutation(api.presence.heartbeat, {
        ...(args.status !== undefined ? { status: args.status } : {}),
      });
    },
    async setStatus(args) {
      return await client.mutation(api.presence.setStatus, {
        status: args.status,
        ...(args.customStatus !== undefined ? { customStatus: args.customStatus } : {}),
      });
    },
    async setTyping(args) {
      return await client.mutation(api.typing.set, { channelId: args.channelId as never });
    },
    async clearTyping(args) {
      await client.mutation(api.typing.clear, { channelId: args.channelId as never });
      return null;
    },
    async setReadState(args) {
      return await client.mutation(api.readStates.set, {
        channelId: args.channelId as never,
        lastReadMessageId: args.lastReadMessageId as never,
      });
    },
  };
}

/** Live subscription side of the chat backend, built on Convex queries. */
export function convexSubscriptions(client: ConvexReactClient): ChatSubscriptions {
  function watch<T>(
    query: Parameters<ConvexReactClient["watchQuery"]>[0],
    args: Record<string, unknown>,
    onChange: (value: T) => void,
  ): () => void {
    const watch = client.watchQuery(query as never, args as never);
    const emit = () => {
      const value = watch.localQueryResult();
      if (value !== undefined) {
        onChange(value as T);
      }
    };
    const unsubscribe = watch.onUpdate(emit);
    // A warm client can deliver the first result before `onUpdate` is attached;
    // read it once so a static query does not hang waiting for a change.
    emit();
    return () => {
      unsubscribe();
    };
  }

  return {
    watchChannels(onChange) {
      return watch<Paginated<ServerChannel>>(
        api.channels.list,
        { paginationOpts: PAGE },
        (result) => onChange(result.page.map(toSummary)),
      );
    },
    watchMessages(channelId, onChange, options) {
      return watch<Paginated<MessagePayload>>(
        api.messages.list,
        { channelId, paginationOpts: { numItems: options?.limit ?? PAGE.numItems, cursor: null } },
        (result) => onChange(result.page),
      );
    },
    watchReactions(messageId, onChange) {
      return watch<ReactionRow[]>(api.reactions.list, { messageId }, onChange);
    },
    watchReactionsBatch(messageIds, onChange) {
      // One subscription per 100-message chunk, so a timeline of thousands of
      // messages costs a handful of queries instead of one per row.
      const unique = [...new Set(messageIds)];
      if (unique.length === 0) {
        onChange([]);
        return () => undefined;
      }
      const chunks: string[][] = [];
      for (let index = 0; index < unique.length; index += REACTION_BATCH_SIZE) {
        chunks.push(unique.slice(index, index + REACTION_BATCH_SIZE));
      }
      const latest = new Map<number, readonly MessageReactionRow[]>();
      const offs = chunks.map((chunk, index) =>
        watch<MessageReactionRow[]>(
          api.reactions.listForMessages,
          { messageIds: chunk as never[] },
          (rows) => {
            latest.set(index, rows);
            onChange([...latest.values()].flat());
          },
        ),
      );
      return () => {
        for (const off of offs) {
          off();
        }
      };
    },
    watchPresence(onChange) {
      return watch<PresenceRow[]>(api.presence.list, {}, onChange);
    },
    watchTyping(channelId, onChange) {
      return watch<TypingRow[]>(api.typing.list, { channelId }, onChange);
    },
    watchReadState(channelId, onChange) {
      return watch<ReadStateRow | null>(api.readStates.get, { channelId }, onChange);
    },
  };
}
