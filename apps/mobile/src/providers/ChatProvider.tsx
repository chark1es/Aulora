import {
  type AttachmentDescriptor,
  type ChannelSummary,
  type ChannelView,
  memoryOutboxStore,
  memorySearchStore,
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
import { createMobileChatRuntime, type MobileChatRuntime } from "../lib/chat-runtime";
import { convexSubscriptions } from "../lib/convex-chat";

export interface ChatSendOptions {
  readonly mentionUserIds?: readonly string[];
  readonly threadRootId?: string;
  readonly attachments?: readonly AttachmentDescriptor[];
}

export interface ChatSendResult {
  readonly queued: boolean;
  readonly messageId?: string;
}

export interface MobileChatContextValue {
  readonly runtime: MobileChatRuntime | undefined;
  readonly ready: boolean;
  readonly channels: readonly ChannelView[];
  readonly presence: readonly PresenceRow[];
  readonly outbox: readonly OutboxItem[];
  sendMessage(channelId: string, text: string, options?: ChatSendOptions): Promise<ChatSendResult>;
  search(query: string): Promise<readonly SearchHit[]>;
}

const ChatContext = createContext<MobileChatContextValue | null>(null);

export interface ChatProviderProps {
  readonly client: ConvexReactClient;
  readonly children: ReactNode;
}

/**
 * Owns the mobile chat runtime, device-local search and the offline outbox.
 * The server seals content at rest; this provider only ever handles plaintext.
 */
export function ChatProvider({ client, children }: ChatProviderProps) {
  const [runtime, setRuntime] = useState<MobileChatRuntime | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [summaries, setSummaries] = useState<readonly ChannelSummary[]>([]);
  const [presence, setPresence] = useState<readonly PresenceRow[]>([]);
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const runtimeRef = useRef<MobileChatRuntime | undefined>(undefined);
  const outboxRef = useRef<Outbox | undefined>(undefined);
  const searchRef = useRef<SearchIndex | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const outboxStore = new Outbox({ store: memoryOutboxStore() });
    const searchIndex = new SearchIndex(memorySearchStore());
    outboxRef.current = outboxStore;
    searchRef.current = searchIndex;
    void searchIndex.load();
    void outboxStore.list().then((items) => {
      if (!cancelled) {
        setOutbox(items);
      }
    });
    void createMobileChatRuntime({ client })
      .then((result) => {
        if (cancelled) {
          result.session.dispose();
          return;
        }
        runtimeRef.current = result;
        setRuntime(result);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // A failed session start must not leave the shell spinning forever.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[aulora] chat runtime failed to start: ${message}`);
        setReady(true);
      });
    return () => {
      cancelled = true;
      runtimeRef.current?.session.dispose();
      runtimeRef.current = undefined;
      outboxRef.current = undefined;
      searchRef.current = undefined;
    };
  }, [client]);

  useEffect(() => {
    const subs = convexSubscriptions(client);
    const offChannels = subs.watchChannels(setSummaries);
    const offPresence = subs.watchPresence(setPresence);
    return () => {
      offChannels();
      offPresence();
    };
  }, [client]);

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

  const sendMessage = useCallback(
    async (
      channelId: string,
      text: string,
      options: ChatSendOptions = {},
    ): Promise<ChatSendResult> => {
      const chat = runtimeRef.current;
      const active = outboxRef.current;
      if (chat === undefined || active === undefined) {
        throw new Error("Chat is not ready yet.");
      }
      const hasPayload = text.trim().length > 0 || (options.attachments?.length ?? 0) > 0;
      if (!hasPayload) {
        return { queued: false };
      }
      const attachmentIds = (options.attachments ?? []).map((attachment) => attachment.fileId);
      try {
        const messageId = await chat.session.sendMessage(channelId, text, {
          ...(options.mentionUserIds !== undefined
            ? { mentionUserIds: options.mentionUserIds }
            : {}),
          ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        });
        return { queued: false, messageId };
      } catch {
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
        setOutbox(await active.list());
        return { queued: true };
      }
    },
    [],
  );

  const search = useCallback(async (query: string): Promise<readonly SearchHit[]> => {
    const index = searchRef.current;
    if (index === undefined) {
      return [];
    }
    return index.query(query, { limit: 20 });
  }, []);

  const views = useMemo<readonly ChannelView[]>(
    () =>
      summaries.map((channel) => ({
        ...channel,
        name: channel.name ?? placeholder(channel),
      })),
    [summaries],
  );

  const value = useMemo<MobileChatContextValue>(
    () => ({
      runtime,
      ready,
      channels: views,
      presence,
      outbox,
      sendMessage,
      search,
    }),
    [runtime, ready, views, presence, outbox, sendMessage, search],
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
export function useChat(): MobileChatContextValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used within a ChatProvider.");
  }
  return value;
}
