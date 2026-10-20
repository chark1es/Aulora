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
    // The newest page stays live; older pages are fetched on demand as one-off
    // snapshots (not subscriptions) and prepended, so scrolling back N pages
    // leaves exactly one live query open and never re-sorts the whole window.
    let tail: readonly MessagePayload[] = [];
    let tailNext: string | null = null;
    let tailLoaded = false;
    let loading = false;
    let cancelled = false;
    const olderPages: { messages: readonly MessagePayload[]; nextCursor: string | null }[] = [];

    function hasOlderNow(): boolean {
      if (!tailLoaded) return false;
      const last = olderPages.at(-1);
      return (last === undefined ? tailNext : last.nextCursor) !== null;
    }
    function merge() {
      const merged: MessagePayload[] = [];
      // Oldest loaded page first, then newer pages, then the live tail — the
      // pages are already chronological, so no re-sort is needed.
      for (let index = olderPages.length - 1; index >= 0; index -= 1) {
        merged.push(...(olderPages[index]?.messages ?? []));
      }
      merged.push(...tail);
      receive(merged);
    }
    const offMessages =
      runtime.watchHistory === undefined
        ? runtime.subscriptions.watchMessages(channelId, (messages) => {
            tail = messages;
            tailNext = null;
            tailLoaded = true;
            setHasOlder(false);
            merge();
          })
        : runtime.watchHistory(channelId, null, (page) => {
            tail = page.messages;
            tailNext = page.isDone ? null : page.cursor;
            tailLoaded = true;
            setHasOlder(hasOlderNow());
            merge();
          });
    loadOlderRef.current = () => {
      if (loading) return;
      const last = olderPages.at(-1);
      const cursor = last === undefined ? tailNext : last.nextCursor;
      const listMessages = runtime.port.listMessages;
      if (cursor === null || listMessages === undefined) return;
      loading = true;
      setLoadingOlder(true);
      void listMessages
        .call(runtime.port, { channelId, cursor })
        .then((page) => {
          if (cancelled) return;
          olderPages.push({
            messages: page.page,
            nextCursor: page.isDone ? null : page.continueCursor,
          });
          void runtime.session.receiveMessages(page.page);
          setHasOlder(hasOlderNow());
          merge();
        })
        .catch(() => undefined)
        .finally(() => {
          if (cancelled) return;
          loading = false;
          setLoadingOlder(false);
        });
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
      cancelled = true;
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
