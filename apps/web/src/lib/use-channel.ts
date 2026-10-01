import type {
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  TypingRow,
} from "@aulora/core";
import { activeTypers, summarizeUnread, type UnreadSummary } from "@aulora/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatRuntime } from "./chat-runtime";

/** Roots per page: the live tail, and each older history page loaded on scroll. */
export const MESSAGE_PAGE_SIZE = 100;

/** Stable empty list returned while a channel's state has not settled yet. */
const EMPTY_MESSAGES: readonly MessagePayload[] = [];
const EMPTY_DECRYPTED: ReadonlyMap<string, string> = new Map();

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
  /** `true` while an older history page is in flight. */
  readonly loadingOlder: boolean;
  /** Loads the next older page of history, keeping the live tail intact. */
  loadOlder(): void;
}

interface OlderPage {
  readonly cursor: string;
  readonly messages: readonly MessagePayload[];
  readonly nextCursor: string | null;
}

/**
 * Subscribes to one channel's live messages, typing and read state.
 *
 * History is walked with Convex cursors rather than by growing the query's
 * `limit`: the live tail is one small subscription, and each older page is
 * fetched by `continueCursor`, so scrolling up N pages costs N small queries
 * instead of re-reading and re-sending the entire window every time. The server
 * keeps each loaded page live, so edits to loaded history still arrive.
 */
export function useChannelSession(
  runtime: ChatRuntime | undefined,
  channelId: string | undefined,
  userId: string,
): ChannelSessionState {
  const [tail, setTail] = useState<readonly MessagePayload[]>([]);
  const [olderPages, setOlderPages] = useState<readonly OlderPage[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [typers, setTypers] = useState<readonly TypingRow[]>([]);
  const [readState, setReadState] = useState<ReadStateRow | null>(null);
  const [readStateLoaded, setReadStateLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [tailNext, setTailNext] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Which channel the currently-held state belongs to. Until it matches the
  // active channel we render the empty state, so a switch never flashes the
  // previous channel's messages for a frame.
  const [loadedChannelId, setLoadedChannelId] = useState<string | undefined>(undefined);

  const olderOffs = useRef<Map<string, () => void>>(new Map());
  const channelRef = useRef<string | undefined>(channelId);

  const releaseOlder = useCallback(() => {
    for (const off of olderOffs.current.values()) {
      off();
    }
    olderOffs.current.clear();
  }, []);

  // A new channel starts from the live tail again: tear down older pages so the
  // next scroll load begins from the tail's cursor.
  useEffect(() => {
    channelRef.current = channelId;
    releaseOlder();
    setTail([]);
    setOlderPages([]);
    setLoading(true);
    setLoadingOlder(false);
    setTailNext(null);
    setReadState(null);
    setReadStateLoaded(false);
  }, [channelId, releaseOlder]);

  useEffect(() => {
    if (runtime === undefined || channelId === undefined) {
      setTail([]);
      setDecrypted(new Map());
      setTypers([]);
      setReadState(null);
      setLoadedChannelId(undefined);
      return;
    }
    setLoadedChannelId(channelId);
    const offTail = runtime.watchChannelMessages(
      channelId,
      (page) => {
        setTail(page.page);
        setTailNext(page.isDone ? null : page.continueCursor);
        setLoading(false);
        void runtime.session.receiveMessages(page.page);
      },
      { limit: MESSAGE_PAGE_SIZE },
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
      offTail();
      offDecrypted();
      offTyping();
      offRead();
    };
  }, [runtime, channelId]);

  // Release any remaining history subscriptions on unmount.
  useEffect(() => releaseOlder, [releaseOlder]);

  // Typing rows carry an expiry the server cannot push; tick while anyone is
  // typing so stale "is typing…" lines disappear on time.
  useEffect(() => {
    if (typers.length === 0) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [typers]);

  const loadOlder = useCallback(() => {
    if (runtime === undefined || channelId === undefined || loadingOlder) {
      return;
    }
    const last = olderPages.at(-1);
    const cursor = last === undefined ? tailNext : last.nextCursor;
    if (cursor === null || cursor === undefined || olderOffs.current.has(cursor)) {
      return;
    }
    setLoadingOlder(true);
    const off = runtime.watchChannelMessages(
      channelId,
      (page) => {
        if (channelRef.current !== channelId) {
          return;
        }
        const entry: OlderPage = {
          cursor,
          messages: page.page,
          nextCursor: page.isDone ? null : page.continueCursor,
        };
        setOlderPages((current) => [...current.filter((item) => item.cursor !== cursor), entry]);
        setLoadingOlder(false);
        void runtime.session.receiveMessages(page.page);
      },
      { limit: MESSAGE_PAGE_SIZE, cursor },
    );
    olderOffs.current.set(cursor, off);
  }, [runtime, channelId, loadingOlder, olderPages, tailNext]);

  const messages = useMemo(() => {
    const merged: MessagePayload[] = [];
    for (let index = olderPages.length - 1; index >= 0; index -= 1) {
      const page = olderPages[index];
      if (page !== undefined) {
        merged.push(...page.messages);
      }
    }
    merged.push(...tail);
    return merged;
  }, [olderPages, tail]);

  const settled = loadedChannelId === channelId;
  const activeMessages = settled ? messages : EMPTY_MESSAGES;
  const activeReadState = settled ? readState : null;

  const visibleTypers = useMemo(
    () => (settled ? activeTypers(typers, userId, now) : []),
    [typers, userId, now, settled],
  );

  const unread = useMemo(
    () =>
      summarizeUnread(
        activeMessages.map((message) => ({
          id: message.id,
          createdAt: message.createdAt,
          authorId: message.authorId,
          mentionedUserIds: message.mentionUserIds,
        })),
        {
          lastReadAt: null,
          lastReadMessageId: activeReadState?.lastReadMessageId ?? null,
          mentionCount: activeReadState?.mentionCount ?? 0,
        },
        userId,
      ),
    [activeMessages, activeReadState, userId],
  );

  const hasOlder =
    settled && (olderPages.length === 0 ? tailNext : olderPages.at(-1)?.nextCursor) !== null;

  return {
    messages: activeMessages,
    decrypted: settled ? decrypted : EMPTY_DECRYPTED,
    typers: visibleTypers,
    readState: activeReadState,
    readStateLoaded: settled && readStateLoaded,
    unread,
    hasOlder,
    loading: settled ? loading : true,
    loadingOlder: settled && loadingOlder,
    loadOlder,
  };
}

export type { PresenceRow, ReactionRow };
