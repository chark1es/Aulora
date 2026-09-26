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
import { mobileKeyStore } from "../lib/keystore";

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
  /** `undefined` when mobile E2EE is unavailable (e.g. Expo Go). */
  readonly runtime: MobileChatRuntime | undefined;
  /** A clear, user-facing reason E2EE is unavailable, or `null`. */
  readonly mlsError: string | null;
  readonly ready: boolean;
  readonly channels: readonly ChannelView[];
  readonly presence: readonly PresenceRow[];
  readonly outbox: readonly OutboxItem[];
  /** Decrypted channel names, keyed by channel id. */
  readonly channelNames: ReadonlyMap<string, string>;
  reportChannelNames(entries: readonly { id: string; ciphertext: string }[]): void;
  sendMessage(channelId: string, text: string, options?: ChatSendOptions): Promise<ChatSendResult>;
  search(query: string): Promise<readonly SearchHit[]>;
}

const ChatContext = createContext<MobileChatContextValue | null>(null);

export interface ChatProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
  readonly children: ReactNode;
}

/**
 * Owns the mobile chat runtime, device-local search and the offline outbox.
 * When the native crypto polyfill is absent the provider still exposes the
 * server's channel list and per-channel presence, plus a clear `mlsError`, so the
 * UI can show the real workspace while stating plainly that message E2EE is
 * unavailable.
 */
export function ChatProvider({ client, userId, displayName, children }: ChatProviderProps) {
  const [runtime, setRuntime] = useState<MobileChatRuntime | undefined>(undefined);
  const [mlsError, setMlsError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [summaries, setSummaries] = useState<readonly ChannelSummary[]>([]);
  const [channelNames, setChannelNames] = useState<ReadonlyMap<string, string>>(new Map());
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
    void createMobileChatRuntime({
      client,
      userId,
      displayName,
      keyStore: mobileKeyStore(),
    })
      .then((result) => {
        if (cancelled) {
          result.runtime?.session.dispose();
          return;
        }
        if (result.mlsError !== null) {
          console.warn(`[aulora] E2EE unavailable: ${result.mlsError}`);
        }
        setMlsError(result.mlsError);
        runtimeRef.current = result.runtime ?? undefined;
        setRuntime(result.runtime ?? undefined);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // A failed session start must not leave the shell spinning forever.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[aulora] chat runtime failed to start: ${message}`);
        setMlsError(message);
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

  const reportChannelNames = useCallback(
    (entries: readonly { id: string; ciphertext: string }[]) => {
      const active = runtimeRef.current;
      if (active === undefined || entries.length === 0) {
        return;
      }
      void Promise.all(
        entries.map(async (entry) => {
          const payload = await active.session.decryptPayload<{ text: string }>(
            entry.id,
            entry.ciphertext,
          );
          return payload === undefined ? null : ([entry.id, payload.text] as const);
        }),
      ).then((resolved) => {
        const found = resolved.filter(
          (value): value is readonly [string, string] => value !== null,
        );
        if (found.length === 0) {
          return;
        }
        setChannelNames((current) => {
          const next = new Map(current);
          for (const [id, name] of found) {
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
        throw new Error("Encryption is not available on this build.");
      }
      const hasPayload = text.trim().length > 0 || (options.attachments?.length ?? 0) > 0;
      if (!hasPayload) {
        return { queued: false };
      }
      try {
        const messageId = await chat.session.sendMessage(channelId, text, options);
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
        name: channelNames.get(channel.id) ?? placeholder(channel),
      })),
    [summaries, channelNames],
  );

  const value = useMemo<MobileChatContextValue>(
    () => ({
      runtime,
      mlsError,
      ready,
      channels: views,
      presence,
      outbox,
      channelNames,
      reportChannelNames,
      sendMessage,
      search,
    }),
    [
      runtime,
      mlsError,
      ready,
      views,
      presence,
      outbox,
      channelNames,
      reportChannelNames,
      sendMessage,
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
export function useChat(): MobileChatContextValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used within a ChatProvider.");
  }
  return value;
}
