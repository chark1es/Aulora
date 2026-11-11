import type {
  ChannelSummaryRow,
  ChatPort,
  ChatSubscriptions,
  MessagePayload,
  MessageReactionRow,
  Paginated,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  TypingRow,
} from "@aulora/core";
import {
  normalizeChannelSummary,
  normalizeMessagePayloads,
  normalizeStoredFile,
  PRESENCE_SCOPE_MAX,
  reportBroadcastFallback,
  resolveServerCapabilities,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { isClosedChannelError } from "./channel-query-error";

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

const capabilityCache = new WeakMap<
  ConvexReactClient,
  {
    connection: number;
    pending: Promise<ReturnType<typeof resolveServerCapabilities>>;
  }
>();
function serverCapabilities(client: ConvexReactClient) {
  const connection = client.connectionState?.().connectionCount ?? 0;
  const cached = capabilityCache.get(client);
  if (cached?.connection === connection) return cached.pending;
  let timer: ReturnType<typeof setTimeout>;
  const pending = Promise.race([
    Promise.resolve()
      .then(() => client.query(api.server.publicConfig, {}))
      .then(resolveServerCapabilities),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Server capability check timed out. Try sending again.")),
        2500,
      );
    }),
  ])
    .finally(() => clearTimeout(timer))
    .catch(() => {
      if (capabilityCache.get(client)?.pending === pending) capabilityCache.delete(client);
      return { mentionMarkers: true };
    });
  capabilityCache.set(client, { connection, pending });
  return pending;
}

/** Imperative side of the chat backend. */
export function convexPort(client: ConvexReactClient): ChatPort {
  capabilityCache.delete(client);
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
    async setChannelPinned(args) {
      await client.mutation(api.channels.setPinned, {
        channelId: args.channelId as never,
        pinned: args.pinned,
      });
      return null;
    },
    async uploadFile(args) {
      const putBytes = async (
        bytes: Uint8Array,
        mime: string,
        skipRateLimit = false,
      ): Promise<string> => {
        // A thumbnail shares the original upload's budget; older servers do not
        // know the flag, so fall back to the plain call.
        const uploadUrl = skipRateLimit
          ? await client
              .mutation(api.files.generateUploadUrl, { skipRateLimit: true })
              .catch(async () => await client.mutation(api.files.generateUploadUrl, {}))
          : await client.mutation(api.files.generateUploadUrl, {});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mime },
          body: bytes as unknown as BodyInit,
        });
        if (!response.ok) {
          // Include the status and, when the storage endpoint explains itself
          // (e.g. "request entity too large"), that text too.
          const detail = await response
            .text()
            .then((text) => text.trim())
            .catch(() => "");
          const suffix = detail.length > 0 ? `: ${detail.slice(0, 200)}` : "";
          throw new Error(`Upload failed (HTTP ${response.status})${suffix}`);
        }
        const body = (await response.json()) as { storageId?: unknown };
        if (typeof body.storageId !== "string") {
          throw new Error("Upload response did not include a storageId");
        }
        return body.storageId;
      };
      const storageId = await putBytes(args.bytes, args.mime);
      // A thumbnail failure must not fail the upload: fall back to the original.
      let thumbnailStorageId: string | undefined;
      if (args.thumbnail !== undefined) {
        try {
          thumbnailStorageId = await putBytes(args.thumbnail.bytes, args.mime, true);
        } catch {
          thumbnailStorageId = undefined;
        }
      }
      const baseArgs = {
        storageId: storageId as never,
        name: args.name,
        mime: args.mime,
        sizeBytes: args.bytes.length,
        ...(args.dimensions !== undefined ? { dimensions: JSON.stringify(args.dimensions) } : {}),
        ...(args.blurhash !== undefined ? { blurhash: args.blurhash } : {}),
        ...(args.channelId !== undefined ? { channelId: args.channelId as never } : {}),
      };
      const finalizeArgs =
        thumbnailStorageId !== undefined
          ? { ...baseArgs, thumbnailStorageId: thumbnailStorageId as never }
          : baseArgs;
      try {
        return await client.action(api.files.finalize, finalizeArgs);
      } catch (error) {
        if (thumbnailStorageId === undefined) {
          throw error;
        }
        // Older servers do not accept the thumbnail argument; keep the image.
        return await client.action(api.files.finalize, baseArgs);
      }
    },
    async getFile(args) {
      const view = await client.query(api.files.get, { fileId: args.fileId as never });
      return view === null ? null : normalizeStoredFile(view);
    },
    async getFiles(args) {
      const views = await client.query(api.files.getMany, {
        fileIds: args.fileIds as never[],
      });
      return views.map(normalizeStoredFile);
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
      const capabilities =
        !args.threadRootId && (args.mentionEveryone === true || args.mentionHere === true)
          ? await serverCapabilities(client)
          : { mentionMarkers: false };
      const payload = {
        channelId: args.channelId as never,
        body: args.body,
        ...(capabilities.mentionMarkers && args.mentionEveryone !== undefined
          ? { mentionEveryone: args.mentionEveryone }
          : {}),
        ...(capabilities.mentionMarkers && args.mentionHere !== undefined
          ? { mentionHere: args.mentionHere }
          : {}),
        ...(args.threadRootId !== undefined ? { threadRootId: args.threadRootId as never } : {}),
        ...(args.replyToId !== undefined ? { replyToId: args.replyToId as never } : {}),
        ...(args.mentionUserIds !== undefined ? { mentionUserIds: [...args.mentionUserIds] } : {}),
        ...(args.mentionRoleIds !== undefined ? { mentionRoleIds: [...args.mentionRoleIds] } : {}),
        ...(args.mentionChannelIds !== undefined
          ? { mentionChannelIds: [...args.mentionChannelIds] }
          : {}),
        ...(args.mentionCategoryIds !== undefined
          ? { mentionCategoryIds: [...args.mentionCategoryIds] }
          : {}),
        ...(args.attachmentIds !== undefined
          ? { attachmentIds: [...args.attachmentIds] as never[] }
          : {}),
      };
      const legacyPayload = async () => {
        const { mentionEveryone: _everyone, mentionHere: _here, ...legacy } = payload;
        if (args.mentionEveryone === true && !args.threadRootId) {
          const channel = await client.query(api.channels.get, {
            channelId: args.channelId as never,
          });
          if (channel.kind !== "dm" && channel.kind !== "group_dm") {
            const audience = await client.query(api.channels.visibleMemberIds, {
              channelId: args.channelId as never,
            });
            legacy.mentionUserIds = [...new Set([...(args.mentionUserIds ?? []), ...audience])];
          }
        }
        return legacy;
      };
      const sendLegacy = async () => {
        const result = await client.mutation(api.messages.send, await legacyPayload());
        if (args.mentionHere === true && !args.threadRootId)
          reportBroadcastFallback(args.channelId);
        return result;
      };
      if (!capabilities.mentionMarkers) return await sendLegacy();
      try {
        return await client.mutation(api.messages.send, payload);
      } catch (error) {
        // Unknown optional arguments after a server rollback: retry exactly once.
        if (
          (payload.mentionEveryone !== undefined || payload.mentionHere !== undefined) &&
          ((error instanceof Error && error.name === "ArgumentValidationError") ||
            /extra field `(?:mentionEveryone|mentionHere)`/.test(String(error)))
        ) {
          capabilityCache.set(client, {
            connection: client.connectionState?.().connectionCount ?? 0,
            pending: Promise.resolve({ mentionMarkers: false }),
          });
          return await sendLegacy();
        }
        throw error;
      }
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
    async listMessages(args) {
      return normalizeMessagePayloads(
        await client.query(api.messages.list, {
          channelId: args.channelId as never,
          paginationOpts: { numItems: PAGE.numItems, cursor: args.cursor },
        }),
      );
    },
    async listThreadMessages(args) {
      return normalizeMessagePayloads(
        await client.query(api.messages.listThread, {
          threadRootId: args.threadRootId as never,
          paginationOpts: { numItems: PAGE.numItems, cursor: args.cursor },
        }),
      );
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
export function convexSubscriptions(
  client: ConvexReactClient,
  onError: (error: unknown) => void = () => undefined,
): ChatSubscriptions {
  function watch<T>(
    query: Parameters<ConvexReactClient["watchQuery"]>[0],
    args: Record<string, unknown>,
    onChange: (value: T) => void,
  ): () => void {
    const watch = client.watchQuery(query as never, args as never);
    const emit = () => {
      let value: ReturnType<typeof watch.localQueryResult>;
      try {
        value = watch.localQueryResult();
      } catch (error) {
        if (getFunctionName(query) === "messages:list" && isClosedChannelError(error)) {
          onError(null);
          onChange({ page: [], isDone: true, continueCursor: "" } as T);
        } else if (["channels:list", "messages:list"].includes(getFunctionName(query)))
          onError(error);
        else console.warn("Secondary chat subscription failed");
        return;
      }
      if (value !== undefined) {
        if (["channels:list", "messages:list"].includes(getFunctionName(query))) onError(null);
        onChange(normalizeMessagePayloads(value as T));
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
      return watch<Paginated<ChannelSummaryRow>>(
        api.channels.list,
        { paginationOpts: PAGE },
        (result) => onChange(result.page.map(normalizeChannelSummary)),
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

/**
 * Scoped presence subscription.
 *
 * The full `presence.list` query returns every workspace member's row to every
 * client and re-sends it on each heartbeat. The apps only render a bounded set
 * of people at a time (the open timeline, the displayed member page, the
 * sidebar's DM partners), so this serves `presence.getMany` over exactly that
 * set instead. Every listener shares one underlying query, and changing the
 * scope tears the old query down and starts a new one for the new ids.
 */
export interface ScopedPresence {
  /** Subscribes to the current scope; emits immediately with the latest rows. */
  watch(onChange: (rows: readonly PresenceRow[]) => void): () => void;
  /** Replaces the scope. Ids are de-duplicated and capped client-side. */
  setScope(userIds: readonly string[]): void;
}

export function createScopedPresence(
  client: ConvexReactClient,
  onError: (error: unknown) => void = () => undefined,
): ScopedPresence {
  const listeners = new Set<(rows: readonly PresenceRow[]) => void>();
  let latest: readonly PresenceRow[] = [];
  let scopeIds: readonly string[] = [];
  let scopeKey = "";
  let teardown: (() => void) | null = null;

  const emit = (): void => {
    for (const listener of [...listeners]) {
      listener(latest);
    }
  };

  const stop = (): void => {
    teardown?.();
    teardown = null;
  };

  const start = (): void => {
    if (teardown !== null || listeners.size === 0) {
      return;
    }
    if (scopeIds.length === 0) {
      latest = [];
      emit();
      return;
    }
    let off: () => void;
    try {
      const watch = client.watchQuery(api.presence.getMany, { userIds: scopeIds as never[] });
      const update = () => {
        let value: ReturnType<typeof watch.localQueryResult>;
        try {
          value = watch.localQueryResult();
        } catch (error) {
          onError(error);
          return;
        }
        if (value !== undefined) {
          latest = value as PresenceRow[];
          emit();
        }
      };
      off = watch.onUpdate(update);
      // A warm client can deliver the first result before `onUpdate` is attached.
      update();
    } catch {
      // Older servers do not have `presence.getMany`; keep only the ids this
      // client renders from the full list instead of breaking presence.
      const watch = client.watchQuery(api.presence.list, {});
      const scoped = new Set(scopeIds);
      const update = () => {
        let value: ReturnType<typeof watch.localQueryResult>;
        try {
          value = watch.localQueryResult();
        } catch (error) {
          onError(error);
          return;
        }
        if (value !== undefined) {
          latest = (value as PresenceRow[]).filter((row) => scoped.has(row.userId));
          emit();
        }
      };
      off = watch.onUpdate(update);
      update();
    }
    teardown = () => {
      off();
    };
  };

  return {
    watch(onChange) {
      listeners.add(onChange);
      onChange(latest);
      start();
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          stop();
          latest = [];
        }
      };
    },
    setScope(userIds) {
      const next = [...new Set(userIds.filter((id) => id.length > 0))].slice(0, PRESENCE_SCOPE_MAX);
      const key = next.join("\u0000");
      if (key === scopeKey) {
        return;
      }
      scopeKey = key;
      scopeIds = next;
      stop();
      // Clear stale rows at once so a status for someone the UI no longer
      // renders can never linger; `start` repopulates from the new query.
      latest = [];
      start();
      emit();
    },
  };
}
