/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type {
  AttachmentDescriptor,
  MentionTarget,
  MessagePayload,
  RoleMentionTarget,
} from "@aulora/core";
import { canUseMassMentions } from "@aulora/core";
import { Button, Icon } from "@aulora/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatRuntime } from "../../lib/chat-runtime";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

export interface ThreadsPanelProps {
  readonly channelKind?: string;
  readonly runtime: ChatRuntime | undefined;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly root: MessagePayload;
  readonly rootText: string | undefined;
  readonly members: readonly MentionTarget[];
  /** Server-side member search for mention autocomplete. */
  readonly searchMembers?: (query: string) => Promise<readonly MentionTarget[]>;
  readonly roles: readonly RoleMentionTarget[];
  readonly memberIds: readonly string[];
  readonly permissions: bigint;
  readonly mentionMarkers?: boolean;
  /** Effective single-upload cap in bytes, forwarded to the reply composer. */
  readonly maxUploadBytes: number;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly mentionNames: readonly string[];
  readonly onClose: () => void;
  readonly onTyping: (channelId: string) => void;
  readonly onSendReply: (input: {
    text: string;
    mentionUserIds: readonly string[];
    mentionEveryone?: boolean;
    mentionHere?: boolean;
    mentionChannelIds?: readonly string[];
    mentionCategoryIds?: readonly string[];
    mentionRoleIds?: readonly string[];
    files: readonly File[];
    /** Also post the reply to the channel timeline, not only the thread. */
    alsoSendToChannel: boolean;
  }) => void | Promise<void>;
  readonly onEdit: (message: MessagePayload, text: string) => void;
  readonly onDelete: (message: MessagePayload) => void;
  readonly onPinToggle: (message: MessagePayload) => void;
  readonly onReact: (message: MessagePayload, emoji: string) => void;
}

/** Side panel with one thread: the root message, its replies and a reply composer. */
export function ThreadsPanel(props: ThreadsPanelProps) {
  const { runtime, channelId, root, rootText } = props;
  const [replies, setReplies] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [repliesError, setRepliesError] = useState(false);
  const loadNext = useRef<() => void>(() => undefined);
  const [alsoSend, setAlsoSend] = useState(false);

  useEffect(() => {
    if (runtime === undefined) return;
    let cancelled = false;
    const pages = new Map<string | null, readonly MessagePayload[]>();
    const indexes = new Map<string | null, number>();
    const failed = new Set<string | null>();
    let nextIndex = 0;
    let sequence = 0;
    const offs: (() => void)[] = [];
    const subscribed = new Map<string | null, object>();
    // listThread is oldest-first today. Lowering this window would hide the
    // live tail for more existing threads; switch to three pages once the
    // backend provides newest-first cursor pagination.
    let pageLimit = 20;
    setLoadingReplies(false);
    setRepliesError(false);
    setNextCursor(null);
    let pendingCursor: string | null = null;
    const subscribe = (cursor: string | null) => {
      if (cancelled || subscribed.has(cursor)) return;
      let index = indexes.get(cursor);
      if (index === undefined) {
        index = nextIndex++;
        indexes.set(cursor, index);
      }
      const pageIndex = index;
      const token = {};
      subscribed.set(cursor, token);
      let stop: (() => void) | undefined;
      stop = runtime.watchThread(
        root.id,
        (incoming) => {
          if (cancelled || subscribed.get(cursor) !== token) return;
          pages.set(cursor, incoming);
          const combined = [
            ...new Map(
              [...pages.entries()]
                .sort(([a], [b]) => (indexes.get(a) ?? 0) - (indexes.get(b) ?? 0))
                .flatMap(([, rows]) => rows)
                .map((row) => [row.id, row]),
            ).values(),
          ];
          const snapshot = ++sequence;
          void runtime.session.receiveMessages(combined, `thread:${root.id}`).then(() => {
            if (cancelled || snapshot !== sequence) return;
            setReplies(combined);
            setDecrypted(
              new Map(combined.map((reply) => [reply.id, runtime.session.decryptedText(reply.id)])),
            );
          });
        },
        {
          cursor,
          onError: () => {
            if (cancelled || subscribed.get(cursor) !== token) return;
            failed.add(cursor);
            setLoadingReplies(false);
            setRepliesError(true);
            subscribed.delete(cursor);
            queueMicrotask(() => stop?.());
          },
          onPage: (page) => {
            if (cancelled || subscribed.get(cursor) !== token) return;
            failed.delete(cursor);
            setLoadingReplies(false);
            setRepliesError(failed.size > 0);
            if (pageIndex !== nextIndex - 1) return;
            pendingCursor = page.isDone ? null : page.continueCursor;
            setNextCursor(pendingCursor);
            if (pendingCursor !== null && indexes.size < pageLimit) subscribe(pendingCursor);
          },
        },
      );
      offs.push(stop);
    };
    loadNext.current = () => {
      const cursor = failed.size > 0 ? [...failed][0] : pendingCursor;
      if (cursor === undefined || subscribed.has(cursor)) return;
      if (failed.size === 0) pageLimit = Math.max(pageLimit, indexes.size + 1);
      setLoadingReplies(true);
      setRepliesError(false);
      subscribe(cursor);
    };
    subscribe(null);
    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
  }, [runtime, root.id]);

  const messages = useMemo(() => [root, ...replies], [root, replies]);
  const texts = useMemo(() => {
    const next = new Map(decrypted);
    if (rootText !== undefined) {
      next.set(root.id, rootText);
    }
    return next;
  }, [decrypted, root.id, rootText]);
  const attachments = useMemo(() => {
    const map = new Map<string, readonly AttachmentDescriptor[]>();
    if (runtime !== undefined) {
      for (const message of messages) {
        const list = runtime.session.attachmentsFor(message.id);
        if (list.length > 0) {
          map.set(message.id, list);
        }
      }
    }
    return map;
  }, [runtime, messages]);

  return (
    <aside
      aria-label="Thread"
      className="pane chat-canvas flex h-full w-[352px] shrink-0 animate-slide-in-right flex-col border-l border-border"
    >
      <header className="material-chrome flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <Icon name="thread" size={18} className="shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text">Thread</h2>
          <p className="truncate text-[11px] text-text-muted">
            {Math.max(root.replyCount ?? 0, replies.length)}{" "}
            {Math.max(root.replyCount ?? 0, replies.length) === 1 ? "reply" : "replies"} ·{" "}
            {props.channelTitle}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close thread"
          title="Close thread"
          onClick={props.onClose}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="x" size={20} />
        </button>
      </header>

      <MessageList
        runtime={runtime}
        channelId={`${channelId}:thread:${root.id}`}
        messages={messages}
        decrypted={texts}
        attachments={attachments}
        pendingIds={new Set()}
        permissions={props.permissions}
        ownUserId={props.ownUserId}
        ownName={props.ownName}
        memberNames={props.memberNames}
        memberColors={props.memberColors}
        mentionNames={props.mentionNames}
        firstUnreadId={null}
        typers={[]}
        hasOlder={false}
        loading={false}
        onLoadOlder={() => undefined}
        onReply={() => undefined}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onPinToggle={props.onPinToggle}
        onReact={props.onReact}
        inThread
      />

      {repliesError && (
        <p role="alert" className="px-4 text-sm text-danger">
          Replies couldn’t load. Try again.
        </p>
      )}
      {(nextCursor !== null || repliesError) && (
        <Button
          loading={loadingReplies}
          disabled={loadingReplies}
          onClick={() => loadNext.current()}
        >
          Load more replies
        </Button>
      )}

      <Composer
        mentionMarkers={props.mentionMarkers ?? false}
        canMentionEveryone={canUseMassMentions(
          { kind: props.channelKind ?? "text" },
          alsoSend ? undefined : props.root.id,
          props.permissions,
        )}
        massMentionHint={
          alsoSend
            ? "Only members with permission can notify everyone in the channel copy."
            : "Notifying everyone isn't available in thread replies."
        }
        channelId={channelId}
        draftKey={`thread:${root.id}`}
        members={props.members}
        {...(props.searchMembers !== undefined ? { searchMembers: props.searchMembers } : {})}
        roles={props.roles}
        memberIds={props.memberIds}
        maxUploadBytes={props.maxUploadBytes}
        placeholder="Reply in thread…"
        windowDropEnabled={false}
        onTyping={props.onTyping}
        onSend={(input) =>
          props.onSendReply({
            text: input.text,
            mentionUserIds: input.mentionUserIds,
            ...(input.mentionEveryone !== undefined
              ? { mentionEveryone: input.mentionEveryone }
              : {}),
            ...(input.mentionHere !== undefined ? { mentionHere: input.mentionHere } : {}),
            mentionChannelIds: input.mentionChannelIds,
            mentionCategoryIds: input.mentionCategoryIds,
            mentionRoleIds: input.mentionRoleIds,
            files: input.files,
            alsoSendToChannel: alsoSend,
          })
        }
        toolbarExtra={
          <label className="ml-1 flex cursor-pointer select-none items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-xs text-text-muted hover:text-text">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={alsoSend}
              onChange={(event) => {
                setAlsoSend(event.target.checked);
              }}
            />
            Also send to channel
          </label>
        }
      />
    </aside>
  );
}
