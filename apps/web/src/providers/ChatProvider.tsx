import {
  type AttachmentDescriptor,
  type ChannelSummary,
  type ChannelView,
  isConnectivityError,
  type MessagePayload,
  Outbox,
  type OutboxItem,
  type PresenceRow,
  type SearchHit,
  SearchIndex,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ChatRuntime, createChatRuntime } from "../lib/chat-runtime";
import { webOutboxStore } from "../lib/outbox-store";
import { webSearchStore } from "../lib/search-store";
import { usePresenceHeartbeat } from "../lib/use-presence-heartbeat";

export interface ChatSearchHit extends SearchHit {
  readonly channelName: string;
}

export interface ChatSendOptions {
  readonly mentionUserIds?: readonly string[];
  readonly threadRootId?: string;
  readonly replyToId?: string;
  readonly attachments?: readonly AttachmentDescriptor[];
}

export interface ChatSendResult {
  /** `true` when the send was queued locally because the device is offline. */
  readonly queued: boolean;
  readonly messageId?: string;
  /** Set when a live send was rejected by the server while online. */
  readonly error?: string;
}

export interface ChatContextValue {
  /** `undefined` until the runtime is ready. */
  readonly runtime: ChatRuntime | undefined;
  /** Channel names, keyed by channel id. */
  readonly channelNames: ReadonlyMap<string, string>;
  /** Caches plaintext channel names for the given channels. */
  reportChannelNames(entries: readonly { id: string; name: string }[]): void;
  readonly presence: readonly PresenceRow[];
  readonly channels: readonly ChannelView[];
  readonly ready: boolean;
  /** Whether the browser currently reports a connection. */
  readonly online: boolean;
  /** Queued offline sends, oldest first; rendered optimistically. */
  readonly outbox: readonly OutboxItem[];
  /** Sends, or queues locally when offline. */
  sendMessage(channelId: string, text: string, options?: ChatSendOptions): Promise<ChatSendResult>;
  /** Re-queues a failed send and immediately attempts to flush it. */
  retrySend?(id: string): Promise<void>;
  /** Drops a queued or failed send without sending it. */
  discardSend?(id: string): Promise<void>;
  /** Queries the local search index. */
  search(query: string): Promise<readonly ChatSearchHit[]>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
  readonly channels: readonly ChannelSummary[];
  readonly children: ReactNode;
}

/**
 * Owns the chat runtime, the device-local search index and the offline outbox
 * for one signed-in device. Messages and channel names arrive as plaintext
 * (the server seals content at rest); nothing is re-encrypted on the client.
 */
export function ChatProvider({
  client,
  userId,
  displayName,
  channels,
  children,
}: ChatProviderProps) {
  const [runtime, setRuntime] = useState<ChatRuntime | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [channelNames, setChannelNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [presence, setPresence] = useState<readonly PresenceRow[]>([]);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const runtimeRef = useRef<ChatRuntime | undefined>(undefined);
  const outboxRef = useRef<Outbox | undefined>(undefined);
  const searchRef = useRef<SearchIndex | undefined>(undefined);

  usePresenceHeartbeat(runtime);

  useEffect(() => {
    let cancelled = false;
    const outboxStore = new Outbox({ store: webOutboxStore() });
    const searchIndex = new SearchIndex(webSearchStore());
    outboxRef.current = outboxStore;
    searchRef.current = searchIndex;
    void searchIndex.load();
    void outboxStore.list().then(async (items) => {
      if (cancelled) {
        return;
      }
      // Recover sends left mid-flight by a crash so they can be retried; a
      // permanently failed item stays surfaced (not "Sending…") for the UI.
      for (const item of items) {
        if (item.status === "sending") {
          await outboxStore.retry(item.id);
        }
      }
      const loaded = await outboxStore.list();
      if (!cancelled) {
        setOutbox(loaded);
      }
    });
    void createChatRuntime({ client, userId, displayName }).then((created) => {
      if (cancelled) {
        created.session.dispose();
        return;
      }
      runtimeRef.current = created;
      setRuntime(created);
      setReady(true);
    });
    return () => {
      cancelled = true;
      runtimeRef.current?.session.dispose();
      runtimeRef.current = undefined;
      outboxRef.current = undefined;
      searchRef.current = undefined;
    };
  }, [client, userId, displayName]);

  // Index every message the session opens with its plaintext body.
  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    return runtime.session.onDecrypted((messages) => {
      const index = searchRef.current;
      if (index === undefined) {
        return;
      }
      for (const message of messages) {
        const text = runtime.session.decryptedText(message.id);
        if (text.length === 0) {
          continue;
        }
        void index.index({
          messageId: message.id,
          channelId: message.channelId,
          authorId: message.authorId,
          text,
          createdAt: message.createdAt,
        });
      }
    });
  }, [runtime]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    return runtime.subscriptions.watchPresence(setPresence);
  }, [runtime]);

  const refreshOutbox = useCallback(async () => {
    const active = outboxRef.current;
    if (active === undefined) {
      return;
    }
    setOutbox(await active.list());
  }, []);

  const flush = useCallback(async () => {
    const active = outboxRef.current;
    const chat = runtimeRef.current;
    if (active === undefined || chat === undefined) {
      return;
    }
    try {
      await active.flush(async (item) => {
        await chat.session.sendMessage(item.channelId, item.text, {
          mentionUserIds: item.mentionUserIds,
          ...(item.threadRootId !== undefined ? { threadRootId: item.threadRootId } : {}),
          ...(item.replyToId !== undefined ? { replyToId: item.replyToId } : {}),
          ...(item.attachments !== undefined && item.attachments.length > 0
            ? { attachmentIds: item.attachments.map((attachment) => attachment.fileId) }
            : {}),
        });
      });
    } catch {
      // Keep the queue intact; the ticker retries on the next tick.
    }
    await refreshOutbox();
  }, [refreshOutbox]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    if (typeof window !== "undefined") {
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      }
    };
  }, [flush]);

  useEffect(() => {
    if (runtime !== undefined && online) {
      void flush();
    }
  }, [runtime, online, flush]);

  // Retry/backoff ticker: even if `online` events are missed, queued sends are
  // attempted once the browser reports a connection.
  useEffect(() => {
    const timer = setInterval(() => {
      const connected = typeof navigator === "undefined" ? true : navigator.onLine;
      setOnline(connected);
      if (connected) {
        void flush();
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [flush]);

  const reportChannelNames = useCallback((entries: readonly { id: string; name: string }[]) => {
    if (entries.length === 0) {
      return;
    }
    setChannelNames((current) => {
      const next = new Map(current);
      for (const entry of entries) {
        if (entry.name.length > 0) {
          next.set(entry.id, entry.name);
        }
      }
      return next;
    });
  }, []);

  // Open each channel once the runtime is ready and cache its plaintext name.
  useEffect(() => {
    const active = runtimeRef.current;
    if (runtime === undefined || active === undefined || channels.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.allSettled(
      channels.map((channel) =>
        (async () => {
          if (cancelled) {
            return;
          }
          await active.session.openChannel(channel);
          if (cancelled) {
            return;
          }
          await active.session.hydrateChannelNames([channel]);
          if (cancelled) {
            return;
          }
          if (channel.kind !== "dm" && channel.kind !== "group_dm") {
            const name = active.session.channelNameFor(channel.id, channel.name);
            setChannelNames((current) => {
              const next = new Map(current);
              next.set(channel.id, name);
              return next;
            });
          }
        })(),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, channels]);

  const sendMessage = useCallback(
    async (
      channelId: string,
      text: string,
      options: ChatSendOptions = {},
    ): Promise<ChatSendResult> => {
      const chat = runtimeRef.current;
      const active = outboxRef.current;
      const hasPayload = text.trim().length > 0 || (options.attachments?.length ?? 0) > 0;
      if (!hasPayload) {
        return { queued: false };
      }
      if (active === undefined) {
        return { queued: false, error: "Chat is not ready" };
      }
      const enqueue = async (): Promise<ChatSendResult> => {
        await active.enqueue(
          {
            channelId,
            text,
            ...(options.mentionUserIds !== undefined
              ? { mentionUserIds: options.mentionUserIds }
              : {}),
            ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
            ...(options.replyToId !== undefined ? { replyToId: options.replyToId } : {}),
            ...(options.attachments !== undefined ? { attachments: options.attachments } : {}),
          },
          Date.now(),
        );
        await refreshOutbox();
        // Try right away in case the connection is actually usable; on a
        // genuine outage the item backs off and the ticker retries later.
        void flush();
        return { queued: true };
      };
      // No runtime yet, or the browser is known to be offline: queue directly.
      if (chat === undefined || !online) {
        return enqueue();
      }
      const attachOptions =
        options.attachments !== undefined && options.attachments.length > 0
          ? { attachmentIds: options.attachments.map((attachment) => attachment.fileId) }
          : {};
      try {
        const messageId = await chat.session.sendMessage(channelId, text, {
          ...(options.mentionUserIds !== undefined
            ? { mentionUserIds: options.mentionUserIds }
            : {}),
          ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
          ...(options.replyToId !== undefined ? { replyToId: options.replyToId } : {}),
          ...attachOptions,
        });
        return { queued: false, messageId };
      } catch (error) {
        // Only a real connectivity failure is parked in the outbox; a server
        // rejection while online is surfaced so the caller can show it.
        if (isConnectivityError(error)) {
          return enqueue();
        }
        return {
          queued: false,
          error:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "Message couldn't be sent. Please try again.",
        };
      }
    },
    [online, refreshOutbox, flush],
  );

  const retrySend = useCallback(
    async (id: string) => {
      const active = outboxRef.current;
      if (active === undefined) {
        return;
      }
      await active.retry(id);
      await refreshOutbox();
      void flush();
    },
    [refreshOutbox, flush],
  );

  const discardSend = useCallback(
    async (id: string) => {
      const active = outboxRef.current;
      if (active === undefined) {
        return;
      }
      await active.remove(id);
      await refreshOutbox();
    },
    [refreshOutbox],
  );

  const search = useCallback(
    async (query: string): Promise<readonly ChatSearchHit[]> => {
      const index = searchRef.current;
      if (index === undefined) {
        return [];
      }
      return index.query(query, { limit: 20 }).map((hit) => ({
        ...hit,
        channelName: channelNames.get(hit.channelId) ?? "channel",
      }));
    },
    [channelNames],
  );

  const views = useMemo<readonly ChannelView[]>(
    () =>
      channels.map((channel) => ({
        ...channel,
        name: channelNames.get(channel.id) ?? placeholder(channel),
      })),
    [channels, channelNames],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      runtime,
      channelNames,
      reportChannelNames,
      presence,
      channels: views,
      ready,
      online,
      outbox,
      sendMessage,
      retrySend,
      discardSend,
      search,
    }),
    [
      runtime,
      channelNames,
      reportChannelNames,
      presence,
      views,
      ready,
      online,
      outbox,
      sendMessage,
      retrySend,
      discardSend,
      search,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function placeholder(channel: ChannelSummary): string {
  if (channel.kind === "dm") {
    return "Direct message";
  }
  if (channel.kind === "group_dm") {
    return "Group message";
  }
  return channel.archived ? "archived" : "channel";
}

/** Reads the chat context; throws outside a {@link ChatProvider}. */
export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used within a ChatProvider.");
  }
  return value;
}

export type { MessagePayload };

/**
 * Supplies a ready-made chat context. Used by the dev-only UI preview, which
 * runs the real chat surface against the in-memory port; production code goes
 * through {@link ChatProvider}.
 */
export const ChatContextProvider = ChatContext.Provider;
