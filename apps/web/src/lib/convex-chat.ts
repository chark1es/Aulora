import type {
  ChannelSummary,
  ChatPort,
  ChatSubscriptions,
  JoinIntentRow,
  MessagePayload,
  MlsCommitRow,
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
 * the mobile app can reuse them with its own adapter. Every value crossing this
 * boundary is ciphertext or plaintext metadata; no keys or plaintext text go
 * the other way.
 */

const PAGE = { numItems: 100, cursor: null } as const;

function toSummary(channel: {
  id: string;
  kind: ChannelSummary["kind"];
  categoryId: string | null;
  nameCiphertext: string | null;
  topicCiphertext: string | null;
  mlsGroupId: string | null;
  archived: boolean;
  currentEpoch: number | null;
  memberIds?: readonly string[];
}): ChannelSummary {
  return {
    id: channel.id,
    kind: channel.kind,
    categoryId: channel.categoryId,
    nameCiphertext: channel.nameCiphertext,
    topicCiphertext: channel.topicCiphertext,
    mlsGroupId: channel.mlsGroupId,
    archived: channel.archived,
    currentEpoch: channel.currentEpoch,
    ...(channel.memberIds !== undefined ? { memberIds: channel.memberIds } : {}),
  };
}

/** Maps a Convex `files` view onto the framework-agnostic stored-file shape. */
function toStoredFile(file: {
  id: string;
  uploaderId: string;
  sizeBytes: number;
  nameCiphertext: string | null;
  mimeCiphertext: string | null;
  dimensionsCiphertext: string | null;
  blurhashCiphertext: string | null;
  url: string | null;
}): StoredFileView {
  return {
    id: file.id,
    uploaderId: file.uploaderId,
    sizeBytes: file.sizeBytes,
    nameCiphertext: file.nameCiphertext,
    mimeCiphertext: file.mimeCiphertext,
    dimensionsCiphertext: file.dimensionsCiphertext,
    blurhashCiphertext: file.blurhashCiphertext,
    url: file.url,
  };
}

/** Imperative side of the chat backend. */
export function convexPort(client: ConvexReactClient): ChatPort {
  return {
    async upsertDevice(args) {
      return await client.mutation(api.devices.upsert, {
        platform: args.platform,
        identityKey: args.identityKey,
        ...(args.pushToken !== undefined ? { pushToken: args.pushToken } : {}),
      });
    },
    async publishKeyPackage(args) {
      return await client.mutation(api.mls.publishKeyPackage, {
        deviceId: args.deviceId as never,
        keyPackage: args.keyPackage,
      });
    },
    async consumeKeyPackages(args) {
      return await client.mutation(api.mls.consume, {
        deviceId: args.deviceId as never,
        count: args.count,
      });
    },
    async createChannel(args) {
      return await client.mutation(api.channels.create, {
        kind: args.kind,
        nameCiphertext: args.nameCiphertext,
        ...(args.mlsGroupId !== undefined ? { mlsGroupId: args.mlsGroupId } : {}),
        ...(args.topicCiphertext !== undefined ? { topicCiphertext: args.topicCiphertext } : {}),
        ...(args.categoryId !== undefined ? { categoryId: args.categoryId as never } : {}),
      });
    },
    async setMlsGroupId(args) {
      return await client.mutation(api.channels.setMlsGroupId, {
        channelId: args.channelId as never,
        mlsGroupId: args.mlsGroupId,
      });
    },
    async renameChannel(args) {
      await client.mutation(api.channels.rename, {
        channelId: args.channelId as never,
        nameCiphertext: args.nameCiphertext,
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
    async createDm(args) {
      return await client.mutation(api.channels.createDm, {
        otherUserId: args.otherUserId,
        ...(args.mlsGroupId !== undefined ? { mlsGroupId: args.mlsGroupId } : {}),
      });
    },
    async createGroupDm(args) {
      return await client.mutation(api.channels.createGroupDm, {
        memberIds: [...args.memberIds],
        ...(args.mlsGroupId !== undefined ? { mlsGroupId: args.mlsGroupId } : {}),
      });
    },
    async getChannelMemberIds(args) {
      const channel = await client.query(api.channels.get, { channelId: args.channelId as never });
      return channel.memberIds ?? [];
    },
    async generateUploadUrl() {
      return await client.mutation(api.files.generateUploadUrl, {});
    },
    async uploadCiphertext(args) {
      const response = await fetch(args.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": args.contentType ?? "application/octet-stream" },
        body: args.bytes as unknown as BodyInit,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }
      const body = (await response.json()) as { storageId?: unknown };
      if (typeof body.storageId !== "string") {
        throw new Error("Upload response did not include a storageId");
      }
      return body.storageId;
    },
    async recordFile(args) {
      return await client.mutation(api.files.record, {
        storageId: args.storageId as never,
        sizeBytes: args.sizeBytes,
        ...(args.nameCiphertext !== undefined ? { nameCiphertext: args.nameCiphertext } : {}),
        ...(args.mimeCiphertext !== undefined ? { mimeCiphertext: args.mimeCiphertext } : {}),
        ...(args.dimensionsCiphertext !== undefined
          ? { dimensionsCiphertext: args.dimensionsCiphertext }
          : {}),
        ...(args.blurhashCiphertext !== undefined
          ? { blurhashCiphertext: args.blurhashCiphertext }
          : {}),
      });
    },
    async fetchCiphertext(args) {
      const response = await fetch(args.url);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
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
    async appendCommit(args) {
      return await client.mutation(api.mls.appendCommit, {
        channelId: args.channelId as never,
        epoch: args.epoch,
        commitCiphertext: args.commitCiphertext,
        ...(args.welcomeCiphertext !== undefined
          ? { welcomeCiphertext: args.welcomeCiphertext }
          : {}),
      });
    },
    async publishJoinIntent(args) {
      return await client.mutation(api.mls.publishJoinIntent, {
        channelId: args.channelId as never,
        deviceId: args.deviceId as never,
        keyPackage: args.keyPackage,
      });
    },
    async markJoinIntentServiced(args) {
      await client.mutation(api.mls.markJoinIntentServiced, { intentId: args.intentId as never });
      return null;
    },
    async sendMessage(args) {
      return await client.mutation(api.messages.send, {
        channelId: args.channelId as never,
        ciphertext: args.ciphertext,
        epoch: args.epoch,
        ...(args.threadRootId !== undefined ? { threadRootId: args.threadRootId as never } : {}),
        ...(args.mentionUserIds !== undefined ? { mentionUserIds: [...args.mentionUserIds] } : {}),
        ...(args.attachmentIds !== undefined
          ? { attachmentIds: args.attachmentIds as never[] }
          : {}),
        ...(args.authorDeviceId !== undefined
          ? { authorDeviceId: args.authorDeviceId as never }
          : {}),
      });
    },
    async editMessage(args) {
      await client.mutation(api.messages.edit, {
        messageId: args.messageId as never,
        ciphertext: args.ciphertext,
        epoch: args.epoch,
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
        emojiCiphertext: args.emojiCiphertext,
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
        ...(args.customStatusCiphertext !== undefined
          ? { customStatusCiphertext: args.customStatusCiphertext }
          : {}),
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
    const unsubscribe = watch.onUpdate(() => {
      const value = watch.localQueryResult();
      if (value !== undefined) {
        onChange(value as T);
      }
    });
    return () => {
      unsubscribe();
    };
  }

  return {
    watchChannels(onChange) {
      return watch<Paginated<ChannelSummary>>(
        api.channels.list,
        { paginationOpts: PAGE },
        (result) => onChange(result.page.map(toSummary)),
      );
    },
    watchMessages(channelId, onChange) {
      return watch<Paginated<MessagePayload>>(
        api.messages.list,
        { channelId, paginationOpts: PAGE },
        (result) => onChange(result.page),
      );
    },
    watchReactions(messageId, onChange) {
      return watch<ReactionRow[]>(api.reactions.list, { messageId }, onChange);
    },
    watchCommits(channelId, afterEpoch, onChange) {
      return watch<MlsCommitRow[]>(api.mls.listCommits, { channelId, afterEpoch }, onChange);
    },
    watchJoinIntents(channelId, onChange) {
      return watch<JoinIntentRow[]>(api.mls.listJoinIntents, { channelId }, onChange);
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
