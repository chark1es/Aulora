import type {
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  TypingRow,
} from "@aulora/core";
import { activeTypers, summarizeUnread, type UnreadSummary } from "@aulora/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatRuntime } from "./chat-runtime";

/** Roots fetched per page; `loadOlder` grows the window by this much. */
export const MESSAGE_PAGE_SIZE = 50;

export interface ChannelSessionState {
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  /** Other members typing right now (expired rows and the viewer removed). */
  readonly typers: readonly TypingRow[];
  readonly readState: ReadStateRow | null;
  /** Whether the read cursor has arrived for this channel (it may be null). */
  readonly readStateLoaded: boolean;
  readonly unread: UnreadSummary;
  /** Whether older history exists beyond the loaded window. */
  readonly hasOlder: boolean;
  /** `true` until the first page for the channel arrives. */
  readonly loading: boolean;
  /** Extends the live window by one page of older messages. */
  loadOlder(): void;
}

/**
 * Subscribes to one channel's live messages, typing and read state, and mirrors
 * the session's plaintext bodies into React state. The bodies never leave this
 * hook except as rendered text.
 */
export function useChannelSession(
  runtime: ChatRuntime | undefined,
  channelId: string | undefined,
  userId: string,
): ChannelSessionState {
  const [messages, setMessages] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [typers, setTypers] = useState<readonly TypingRow[]>([]);
  const [readState, setReadState] = useState<ReadStateRow | null>(null);
  const [readStateLoaded, setReadStateLoaded] = useState(false);
  const [limit, setLimit] = useState(MESSAGE_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // A new channel starts from the live tail again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is the reset trigger
  useEffect(() => {
    setLimit(MESSAGE_PAGE_SIZE);
    setLoading(true);
    setMessages([]);
    setReadState(null);
    setReadStateLoaded(false);
  }, [channelId]);

  useEffect(() => {
    if (runtime === undefined || channelId === undefined) {
      setMessages([]);
      setDecrypted(new Map());
      setTypers([]);
      setReadState(null);
      return;
    }
    const offMessages = runtime.subscriptions.watchMessages(
      channelId,
      (incoming) => {
        setMessages(incoming);
        setLoading(false);
        void runtime.session.receiveMessages(incoming);
      },
      { limit },
    );
    // The session owns the plaintext cache; mirror its events into React state
    // so a message opened by any subscription path (not just this one) renders.
    const offDecrypted = runtime.session.onDecrypted((messages) => {
      setDecrypted((current) => {
        const next = new Map(current);
        for (const message of messages) {
          if (message.channelId !== channelId) {
            continue;
          }
          next.set(message.id, runtime.session.decryptedText(message.id));
        }
        return next;
      });
    });
    const offTyping = runtime.subscriptions.watchTyping(channelId, setTypers);
    const offRead = runtime.subscriptions.watchReadState(channelId, (state) => {
      setReadState(state);
      setReadStateLoaded(true);
    });
    return () => {
      offMessages();
      offDecrypted();
      offTyping();
      offRead();
    };
  }, [runtime, channelId, limit]);

  // Typing rows carry an expiry the server cannot push; tick while anyone is
  // typing so stale "is typing…" lines disappear on time.
  useEffect(() => {
    if (typers.length === 0) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [typers]);

  const visibleTypers = useMemo(() => activeTypers(typers, userId, now), [typers, userId, now]);
  const loadOlder = useCallback(() => setLimit((current) => current + MESSAGE_PAGE_SIZE), []);

  const unread = useMemo(
    () =>
      summarizeUnread(
        messages.map((message) => ({
          id: message.id,
          createdAt: message.createdAt,
          authorId: message.authorId,
          mentionedUserIds: message.mentionUserIds,
        })),
        {
          lastReadAt: null,
          lastReadMessageId: readState?.lastReadMessageId ?? null,
          mentionCount: readState?.mentionCount ?? 0,
        },
        userId,
      ),
    [messages, readState, userId],
  );

  return {
    messages,
    decrypted,
    typers: visibleTypers,
    readState,
    readStateLoaded,
    unread,
    hasOlder: messages.length >= limit,
    loading,
    loadOlder,
  };
}

export type { PresenceRow, ReactionRow };
