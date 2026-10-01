import type {
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  TypingRow,
} from "@aulora/core";
import { summarizeUnread, type UnreadSummary } from "@aulora/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSurfaceRuntime } from "./chat-surface";

export interface ChannelSessionState {
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  readonly typers: readonly TypingRow[];
  readonly readState: ReadStateRow | null;
  readonly unread: UnreadSummary;
  readonly hasOlder: boolean;
  readonly loadingOlder: boolean;
  readonly loadOlder: () => void;
}

/**
 * Subscribes to one channel's live messages, typing and read state. The server
 * returns message bodies as plaintext, so no decryption happens here; the map
 * is just a stable id-to-text view for rendering. Mirrors the web hook so both
 * clients behave identically.
 */
export function useChannelSession(
  runtime: ChatSurfaceRuntime | undefined,
  channelId: string | undefined,
  userId: string,
): ChannelSessionState {
  const [messages, setMessages] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [typers, setTypers] = useState<readonly TypingRow[]>([]);
  const [readState, setReadState] = useState<ReadStateRow | null>(null);
  const [loadedChannelId, setLoadedChannelId] = useState<string | undefined>(undefined);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlderRef = useRef<() => void>(() => {});

  useEffect(() => {
    setHasOlder(false);
    setLoadingOlder(false);
    loadOlderRef.current = () => {};
    if (runtime === undefined || channelId === undefined) {
      setMessages([]);
      setDecrypted(new Map());
      setTypers([]);
      setReadState(null);
      setLoadedChannelId(undefined);
      return;
    }
    // Clear the previous channel's state immediately so a switch never shows a
    // stale timeline or reactions for one frame.
    setMessages([]);
    setDecrypted(new Map());
    setTypers([]);
    setReadState(null);
    setLoadedChannelId(channelId);
    const receive = (incoming: readonly MessagePayload[]) => {
      setMessages(incoming);
      void runtime.session.receiveMessages(incoming);
    };
    const pages = new Map<string | null, readonly MessagePayload[]>();
    const historyOff: (() => void)[] = [];
    let nextCursor: string | null = null;
    let oldestCursor: string | null = null;
    let loading = false;
    function subscribePage(cursor: string | null) {
      oldestCursor = cursor;
      const off = runtime?.watchHistory?.(channelId ?? "", cursor, (page) => {
        pages.set(cursor, page.messages);
        const all = new Map<string, MessagePayload>();
        for (const messages of pages.values())
          for (const message of messages) all.set(message.id, message);
        receive([...all.values()].sort((a, b) => a.createdAt - b.createdAt));
        // The oldest subscribed page owns the next continuation.
        if (cursor === oldestCursor) {
          nextCursor = page.isDone ? null : page.cursor;
          setHasOlder(!page.isDone);
          loading = false;
          setLoadingOlder(false);
        }
      });
      if (off !== undefined) historyOff.push(off);
    }
    const offMessages =
      runtime.watchHistory === undefined
        ? runtime.subscriptions.watchMessages(channelId, receive)
        : (() => {
            subscribePage(null);
            return () => {
              for (const off of historyOff) off();
            };
          })();
    loadOlderRef.current = () => {
      if (nextCursor === null || loading) return;
      loading = true;
      setLoadingOlder(true);
      subscribePage(nextCursor);
    };
    const offDecrypted = runtime.session.onDecrypted((opened) => {
      setDecrypted((current) => {
        const next = new Map(current);
        for (const message of opened) {
          if (message.channelId !== channelId) {
            continue;
          }
          next.set(message.id, runtime.session.decryptedText(message.id));
        }
        return next;
      });
    });
    const offTyping = runtime.subscriptions.watchTyping(channelId, setTypers);
    const offRead = runtime.subscriptions.watchReadState(channelId, setReadState);
    return () => {
      offMessages();
      offDecrypted();
      offTyping();
      offRead();
    };
  }, [runtime, channelId]);

  const settled = loadedChannelId === channelId;

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
    messages: settled ? messages : [],
    decrypted: settled ? decrypted : new Map(),
    typers: settled ? typers : [],
    readState: settled ? readState : null,
    unread,
    hasOlder: settled && hasOlder,
    loadingOlder: settled && loadingOlder,
    loadOlder: () => loadOlderRef.current(),
  };
}

export type { PresenceRow, ReactionRow };
