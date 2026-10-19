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

/**
 * How many older history pages stay retained at once. Scrolling back through a
 * long channel used to keep every loaded page mounted for the life of the view
 * (unbounded DOM/RAM/CPU). The window slides with the reader instead: loading a
 * page past this cap evicts the page retained the longest — the one nearest the
 * live tail, already far below the viewport — so the mounted window stays
 * bounded (~1,200 messages) while the live tail is always kept. The evicted
 * pages are re-fetched from the tail cursor if the reader returns to the bottom.
 */
export const MAX_RETAINED_PAGES = 12;

/** Stable empty list returned while a channel's state has not settled yet. */
const EMPTY_MESSAGES: readonly MessagePayload[] = [];
const EMPTY_DECRYPTED: ReadonlyMap<string, string> = new Map();

/**
 * Neutral unread summary used until the read cursor has arrived. Without it,
 * messages that load before the cursor would all look unread and briefly flash
 * the "New messages" divider on a channel switch.
 */
const EMPTY_UNREAD: UnreadSummary = {
  unread: false,
  unreadCount: 0,
  mentionCount: 0,
  firstUnreadId: null,
};

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
  /**
   * Id of the oldest live-tail message when the retained history window has
   * been truncated (older pages were evicted). The timeline draws a boundary
   * before it instead of silently showing a gap; `null` when nothing was
   * evicted and the window is still contiguous with the tail.
   */
  readonly historySeamId: string | null;
  /** Loads the next older page of history, keeping the live tail intact. */
  readonly loadOlder: () => void;
  /**
   * Drops the retained older pages and re-anchors the window to the live tail so
   * the pages evicted by the cap are re-fetched from the tail cursor. The
   * timeline calls this when the reader settles back at the newest message.
   */
  readonly resetHistoryWindow: () => void;
}

interface OlderPage {
  readonly cursor: string;
  readonly messages: readonly MessagePayload[];
  readonly nextCursor: string | null;
}

interface ChannelSubscriptions {
  readonly setTail: (messages: readonly MessagePayload[]) => void;
  readonly setTailNext: (cursor: string | null) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setDecrypted: (
    updater: (current: ReadonlyMap<string, string>) => ReadonlyMap<string, string>,
  ) => void;
  readonly setTypers: (typers: readonly TypingRow[]) => void;
  readonly setReadState: (state: ReadStateRow | null) => void;
  readonly setReadStateLoaded: (loaded: boolean) => void;
}

/**
 * Opens the live tail, plaintext-mirror, typing and read-state subscriptions
 * for one channel and returns a teardown that releases all four.
 */
function subscribeToChannel(
  runtime: ChatRuntime,
  channelId: string,
  state: ChannelSubscriptions,
): () => void {
  const offTail = runtime.watchChannelMessages(
    channelId,
    (page) => {
      state.setTail(page.page);
      state.setTailNext(page.isDone ? null : page.continueCursor);
      state.setLoading(false);
      void runtime.session.receiveMessages(page.page);
    },
    { limit: MESSAGE_PAGE_SIZE },
  );
  // The session owns the plaintext cache; mirror its events into React state
  // so a message opened by any subscription path (not just this one) renders.
  const offDecrypted = runtime.session.onDecrypted((messages) => {
    state.setDecrypted((current) => {
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
  const offTyping = runtime.subscriptions.watchTyping(channelId, state.setTypers);
  const offRead = runtime.subscriptions.watchReadState(channelId, (readState) => {
    state.setReadState(readState);
    state.setReadStateLoaded(true);
  });
  return () => {
    offTail();
    offDecrypted();
    offTyping();
    offRead();
  };
}

function summarizeForReader(
  messages: readonly MessagePayload[],
  readState: ReadStateRow | null,
  userId: string,
): UnreadSummary {
  return summarizeUnread(
    // Deleted messages are hidden from the timeline, so they must not count as
    // unread or anchor the "New messages" divider either.
    messages
      .filter((message) => message.deletedAt === null)
      .map((message) => ({
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
  );
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
  // `true` once the retained window has outgrown {@link MAX_RETAINED_PAGES} and
  // the oldest page was dropped, so the timeline can mark the seam.
  const [truncated, setTruncated] = useState(false);
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

  // Re-anchor the history window to the live tail, dropping the retained pages
  // (and their subscriptions) so any pages the cap evicted are re-fetched from
  // the tail cursor the next time the reader scrolls up.
  const resetHistoryWindow = useCallback(() => {
    releaseOlder();
    setOlderPages([]);
    setLoadingOlder(false);
    setTruncated(false);
  }, [releaseOlder]);

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
    setTruncated(false);
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
    return subscribeToChannel(runtime, channelId, {
      setTail,
      setTailNext,
      setLoading,
      setDecrypted,
      setTypers,
      setReadState,
      setReadStateLoaded,
    });
  }, [runtime, channelId]);

  // Release any remaining history subscriptions on unmount.
  useEffect(() => {
    return releaseOlder;
  }, [releaseOlder]);

  // Typing rows carry an expiry the server cannot push; tick while anyone is
  // typing so stale "is typing…" lines disappear on time.
  useEffect(() => {
    if (typers.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [typers]);

  const loadOlder = useCallback(() => {
    if (runtime === undefined || channelId === undefined || loadingOlder) {
      return;
    }
    const last = olderPages.at(-1);
    const cursor = last === undefined ? tailNext : last.nextCursor;
    if (cursor === null || olderOffs.current.has(cursor)) {
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
        // Replace in place when this page is already loaded (a live edit) so the
        // chronological order — which the window cap relies on — is preserved;
        // otherwise append it as the newly-deepest page.
        setOlderPages((current) => {
          const index = current.findIndex((item) => item.cursor === cursor);
          if (index === -1) {
            return [...current, entry];
          }
          const next = [...current];
          next[index] = entry;
          return next;
        });
        setLoadingOlder(false);
        void runtime.session.receiveMessages(page.page);
      },
      { limit: MESSAGE_PAGE_SIZE, cursor },
    );
    olderOffs.current.set(cursor, off);
  }, [runtime, channelId, loadingOlder, olderPages, tailNext]);

  const messages = useMemo(() => {
    const merged: MessagePayload[] = [];
    for (const page of [...olderPages].reverse()) {
      merged.push(...page.messages);
    }
    merged.push(...tail);
    return merged;
  }, [olderPages, tail]);

  // Bound the retained window: once older pages exceed the cap, drop the ones
  // that have been retained the longest (nearest the live tail) and release
  // their live subscriptions. The window therefore slides with the reader and
  // mounting/CPU stay flat no matter how far back they scroll; the newest page
  // of history and the live tail are always kept.
  useEffect(() => {
    if (olderPages.length <= MAX_RETAINED_PAGES) {
      return;
    }
    const excess = olderPages.length - MAX_RETAINED_PAGES;
    for (const page of olderPages.slice(0, excess)) {
      const off = olderOffs.current.get(page.cursor);
      if (off !== undefined) {
        olderOffs.current.delete(page.cursor);
        off();
      }
    }
    setOlderPages(olderPages.slice(excess));
    setTruncated(true);
  }, [olderPages]);

  const settled = loadedChannelId === channelId;
  const activeMessages = settled ? messages : EMPTY_MESSAGES;
  const activeReadState = settled ? readState : null;
  const activeReadStateLoaded = settled && readStateLoaded;

  const visibleTypers = useMemo(
    () => (settled ? activeTypers(typers, userId, now) : []),
    [typers, userId, now, settled],
  );

  const unread = useMemo(
    () =>
      activeReadStateLoaded
        ? summarizeForReader(activeMessages, activeReadState, userId)
        : EMPTY_UNREAD,
    [activeMessages, activeReadState, activeReadStateLoaded, userId],
  );

  const hasOlder =
    settled && (olderPages.length === 0 ? tailNext : olderPages.at(-1)?.nextCursor) !== null;

  // When the window has been truncated, the retained history no longer reaches
  // the live tail; mark the seam so the timeline can make the dropped region
  // explicit rather than silently jumping in time.
  const historySeamId = settled && truncated ? (tail[0]?.id ?? null) : null;

  return {
    messages: activeMessages,
    decrypted: settled ? decrypted : EMPTY_DECRYPTED,
    typers: visibleTypers,
    readState: activeReadState,
    readStateLoaded: activeReadStateLoaded,
    unread,
    hasOlder,
    loading: settled ? loading : true,
    loadingOlder: settled && loadingOlder,
    historySeamId,
    loadOlder,
    resetHistoryWindow,
  };
}

export type { PresenceRow, ReactionRow };
