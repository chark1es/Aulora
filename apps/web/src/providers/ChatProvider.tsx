import {
  type AttachmentDescriptor,
  type ChannelSummary,
  type ChannelView,
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

export interface ChatSearchHit extends SearchHit {
  readonly channelName: string;
}

export interface ChatSendOptions {
  readonly mentionUserIds?: readonly string[];
  readonly threadRootId?: string;
  readonly attachments?: readonly AttachmentDescriptor[];
}

export interface ChatSendResult {
  /** `true` when the send was queued locally because the device is offline. */
  readonly queued: boolean;
  readonly messageId?: string;
}

export interface ChatContextValue {
  /** `undefined` until the runtime and device identity are ready. */
  readonly runtime: ChatRuntime | undefined;
  /** Decrypted channel names, keyed by channel id. */
  readonly channelNames: ReadonlyMap<string, string>;
  /** Decrypts and caches channel names for the given channels. */
  reportChannelNames(entries: readonly { id: string; ciphertext: string }[]): void;
  readonly presence: readonly PresenceRow[];
  readonly channels: readonly ChannelView[];
  readonly ready: boolean;
  /** Whether the browser currently reports a connection. */
  readonly online: boolean;
  /** Queued offline sends, oldest first; rendered optimistically. */
  readonly outbox: readonly OutboxItem[];
  /** Encrypts and sends, or queues locally when offline. */
  sendMessage(channelId: string, text: string, options?: ChatSendOptions): Promise<ChatSendResult>;
  /** Queries the local decrypted search index. */
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
 * for one signed-in device. Channel names and message text are only ever
 * decrypted here or in the session; plaintext never leaves the device.
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

  useEffect(() => {
    let cancelled = false;
    const outboxStore = new Outbox({ store: webOutboxStore() });
    const searchIndex = new SearchIndex(webSearchStore());
    outboxRef.current = outboxStore;
    searchRef.current = searchIndex;
    void searchIndex.load();
    void outboxStore.list().then((items) => {
      if (!cancelled) {
        setOutbox(items);
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

  // Index every message the session opens, feeding only decrypted text.
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
        if (text === undefined) {
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
    await active.flush(async (item) => {
      await chat.session.sendMessage(item.channelId, item.text, {
        mentionUserIds: item.mentionUserIds,
        ...(item.threadRootId !== undefined ? { threadRootId: item.threadRootId } : {}),
        ...(item.attachments !== undefined ? { attachments: item.attachments } : {}),
      });
    });
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

  const reportChannelNames = useCallback(
    (entries: readonly { id: string; ciphertext: string }[]) => {
      const active = runtimeRef.current;
      if (active === undefined || entries.length === 0) {
        return;
      }
      void decryptNames(active, entries).then((decrypted) => {
        if (decrypted.size === 0) {
          return;
        }
        setChannelNames((current) => {
          const next = new Map(current);
          for (const [id, name] of decrypted) {
            next.set(id, name);
          }
          return next;
        });
      });
    },
    [],
  );

  const sendMessage = useCallback(
    async (
      channelId: string,
      text: string,
      options: ChatSendOptions = {},
    ): Promise<ChatSendResult> => {
      const chat = runtimeRef.current;
      const active = outboxRef.current;
      if (chat === undefined || active === undefined) {
        throw new Error("Chat is not ready");
      }
      const hasPayload = text.trim().length > 0 || (options.attachments?.length ?? 0) > 0;
      if (!hasPayload) {
        return { queued: false };
      }
      if (online) {
        try {
          const messageId = await chat.session.sendMessage(channelId, text, options);
          return { queued: false, messageId };
        } catch {
          // Network failure: fall through and queue the ciphertext payload.
        }
      }
      await active.enqueue(
        {
          channelId,
          text,
          ...(options.mentionUserIds !== undefined
            ? { mentionUserIds: options.mentionUserIds }
            : {}),
          ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
          ...(options.attachments !== undefined ? { attachments: options.attachments } : {}),
        },
        Date.now(),
      );
      await refreshOutbox();
      return { queued: true };
    },
    [online, refreshOutbox],
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
      search,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

async function decryptNames(
  runtime: ChatRuntime,
  entries: readonly { id: string; ciphertext: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of entries) {
    const payload = await runtime.session.decryptPayload<{ text: string }>(
      entry.id,
      entry.ciphertext,
    );
    if (payload !== undefined) {
      result.set(entry.id, payload.text);
    }
  }
  return result;
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
