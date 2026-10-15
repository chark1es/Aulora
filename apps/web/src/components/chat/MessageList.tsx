import type {
  AttachmentDescriptor,
  MessagePayload,
  MessageReactionRow,
  TimelineItem,
  TypingRow,
} from "@aulora/core";
import {
  activityLabel,
  buildTimeline,
  dayLabel,
  hasPermission,
  messageTime,
  Permission,
} from "@aulora/core";
import { Button, type ContextMenuItem, cn, Icon, Spinner, useContextMenu } from "@aulora/ui-web";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatRuntime } from "../../lib/chat-runtime";
import { AttachmentView } from "./AttachmentView";
import { EmojiPicker } from "./EmojiPicker";
import { PresenceAvatar } from "./PresenceAvatar";
import { ReactionChips, type ReactionGroup } from "./ReactionChips";
import { RichText } from "./RichText";

export interface MessageListProps {
  readonly runtime: ChatRuntime | undefined;
  readonly channelId: string;
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  readonly attachments: ReadonlyMap<string, readonly AttachmentDescriptor[]>;
  readonly pendingIds: ReadonlySet<string>;
  /** Optimistic ids (`pending:<outboxItemId>`) that permanently failed to send. */
  readonly failedIds?: ReadonlySet<string>;
  /** Re-queues a failed optimistic send; receives the `pending:<id>` key. */
  readonly onRetrySend?: (pendingId: string) => void;
  /** Drops a failed optimistic send; receives the `pending:<id>` key. */
  readonly onDiscardSend?: (pendingId: string) => void;
  readonly permissions: bigint;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly memberNames: ReadonlyMap<string, string>;
  /** Highest-position role color per user id, for rings and tinted names. */
  readonly memberColors?: ReadonlyMap<string, string>;
  /** Names `@mentions` may refer to, for highlighting. */
  readonly mentionNames: readonly string[];
  /** Channel/category names `#mentions` may refer to. */
  readonly channelNames?: readonly string[];
  /** Navigates to a channel when its `#mention` is clicked. */
  readonly onChannelClick?: (name: string) => void;
  /** Where the "New messages" divider goes; fixed when the channel opens. */
  readonly firstUnreadId: string | null;
  readonly typers: readonly TypingRow[];
  readonly hasOlder: boolean;
  readonly loading: boolean;
  readonly onLoadOlder: () => void;
  readonly onReply: (message: MessagePayload) => void;
  readonly onEdit: (message: MessagePayload, text: string) => void;
  readonly onDelete: (message: MessagePayload) => void;
  readonly onPinToggle: (message: MessagePayload) => void;
  readonly onReact: (message: MessagePayload, emoji: string) => void;
  /** Shown when the channel has no messages yet. */
  readonly emptyState?: ReactNode;
  /** Rendering a thread: no nested-thread actions or reply summaries. */
  readonly inThread?: boolean;
  /** Starts an inline (quoted) reply to the message. */
  readonly onReplyTo?: (message: MessagePayload) => void;
  /** Quoted previews for inline replies, keyed by the target message id. */
  readonly replyPreviews?: ReadonlyMap<
    string,
    { readonly authorName: string; readonly text: string; readonly authorId?: string }
  >;
  /** Which side the viewer's own messages render on. Defaults to "left". */
  readonly ownSide?: "left" | "right";
}

/** Stable empty value so rows without reactions do not re-render needlessly. */
const NO_REACTIONS: readonly ReactionGroup[] = [];

/** Within this distance of the bottom the list follows new messages. */
const STICK_THRESHOLD_PX = 96;
/** Within this distance of the top the list fetches older history. */
const LOAD_OLDER_THRESHOLD_PX = 160;

/**
 * The conversation timeline: message bubbles grouped into author runs, day
 * separators, the unread divider and a typing bubble. It follows the live tail
 * while the reader is at the bottom, loads older history when they scroll up
 * (keeping their place), and offers a jump back to the latest message.
 */
export function MessageList(props: MessageListProps) {
  const {
    channelId,
    messages,
    firstUnreadId,
    typers,
    hasOlder,
    loading,
    onLoadOlder,
    memberNames,
    memberColors,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const olderAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const positionedChannelRef = useRef<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const items = useMemo(
    () =>
      buildTimeline(messages, { firstUnreadId }).map((item) =>
        // A pinned message needs its author header (and the pin itself) even
        // when it continues an author run, so force the run to start here.
        item.kind === "message" && item.message.pinnedAt !== null
          ? { ...item, startsGroup: true }
          : item,
      ),
    [messages, firstUnreadId],
  );

  // One batched reactions subscription for the whole timeline, chunked by the
  // adapter, instead of one live query per rendered message.
  const messageIds = useMemo(
    () => items.flatMap((item) => (item.kind === "message" ? [item.message.id] : [])),
    [items],
  );
  const [reactionsByMessage, setReactionsByMessage] = useState<
    ReadonlyMap<string, readonly ReactionGroup[]>
  >(() => new Map());
  const subscriptions = props.runtime?.subscriptions;
  const ownUserId = props.ownUserId;
  useEffect(() => {
    if (subscriptions?.watchReactionsBatch === undefined || messageIds.length === 0) {
      return;
    }
    return subscriptions.watchReactionsBatch(messageIds, (rows: readonly MessageReactionRow[]) => {
      const updated = groupReactionsByMessage(rows, ownUserId);
      setReactionsByMessage((current) => {
        const next = new Map(current);
        for (const id of messageIds) next.delete(id);
        for (const [id, groups] of updated) next.set(id, groups);
        return next;
      });
    });
  }, [subscriptions, messageIds, ownUserId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = scrollRef.current;
    if (node !== null) {
      node.scrollTo({ top: node.scrollHeight, behavior });
    }
  }, []);

  const updateBottomState = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const pinned = distance < STICK_THRESHOLD_PX;
    stickRef.current = pinned;
    setAtBottom(pinned);
  }, []);

  // A new channel starts pinned to the bottom until it is first positioned.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is the reset trigger
  useLayoutEffect(() => {
    stickRef.current = true;
    olderAnchorRef.current = null;
    positionedChannelRef.current = null;
    setAtBottom(true);
  }, [channelId]);

  // After each render: restore the reader's place when older history was
  // prepended, open a fresh channel at the unread divider (or the bottom), and
  // otherwise follow the tail while pinned.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    const anchor = olderAnchorRef.current;
    if (anchor !== null) {
      node.scrollTop = anchor.top + (node.scrollHeight - anchor.height);
      olderAnchorRef.current = null;
      updateBottomState();
      return;
    }
    if (positionedChannelRef.current !== channelId && messages.length > 0) {
      positionedChannelRef.current = channelId;
      const divider = node.querySelector<HTMLElement>("[data-unread-divider]");
      if (divider !== null) {
        node.scrollTop = Math.max(0, divider.offsetTop - node.clientHeight / 3);
        updateBottomState();
        return;
      }
    }
    if (stickRef.current) {
      node.scrollTop = node.scrollHeight;
    }
    updateBottomState();
  });

  // Images and viewport resizing change the distance to the bottom, even when
  // the browser does not fire a scroll event.
  useEffect(() => {
    const content = contentRef.current;
    const node = scrollRef.current;
    if (content === null || node === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        scrollToBottom();
      }
      updateBottomState();
    });
    observer.observe(content);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [scrollToBottom, updateBottomState]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    updateBottomState();
    if (
      node.scrollTop < LOAD_OLDER_THRESHOLD_PX &&
      hasOlder &&
      !loading &&
      olderAnchorRef.current === null &&
      positionedChannelRef.current === channelId
    ) {
      olderAnchorRef.current = { height: node.scrollHeight, top: node.scrollTop };
      onLoadOlder();
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="message-list"
        data-channel={channelId}
      >
        <div
          ref={contentRef}
          className="flex min-h-full flex-col justify-end px-4 pb-4 pt-5 sm:px-6"
        >
          {hasOlder && (
            <div className="flex justify-center py-3">
              <button
                type="button"
                onClick={() => {
                  const node = scrollRef.current;
                  if (node !== null) {
                    olderAnchorRef.current = { height: node.scrollHeight, top: node.scrollTop };
                  }
                  onLoadOlder();
                }}
                className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
              >
                Load earlier messages
              </button>
            </div>
          )}
          {loading && messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <Spinner size={24} label="Loading messages" />
            </div>
          ) : messages.length === 0 ? (
            props.emptyState
          ) : (
            items.map((item) => (
              <TimelineRow
                key={item.key}
                item={item}
                list={props}
                reactionsByMessage={reactionsByMessage}
              />
            ))
          )}
          {typers.length > 0 && (
            <TypingBubble typers={typers} memberNames={memberNames} memberColors={memberColors} />
          )}
        </div>
      </div>

      {!atBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true;
            setAtBottom(true);
            scrollToBottom("smooth");
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-text shadow-lg shadow-black/15 transition hover:bg-surface-3"
        >
          <Icon name="arrow-down" size={14} />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function TimelineRow({
  item,
  list,
  reactionsByMessage,
}: {
  readonly item: TimelineItem;
  readonly list: MessageListProps;
  readonly reactionsByMessage: ReadonlyMap<string, readonly ReactionGroup[]>;
}) {
  if (item.kind === "day") {
    return (
      <div className="flex items-center gap-3 py-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {dayLabel(item.dayStart)}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  if (item.kind === "unread") {
    return (
      <div className="flex items-center gap-3 py-2" data-unread-divider>
        <span className="h-px flex-1 bg-accent/60" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          New messages
        </span>
        <span className="h-px flex-1 bg-accent/60" />
      </div>
    );
  }
  return (
    <MessageRow
      list={list}
      message={item.message}
      startsGroup={item.startsGroup}
      reactions={reactionsByMessage.get(item.message.id) ?? NO_REACTIONS}
    />
  );
}

function MessageRow({
  list,
  message,
  startsGroup,
  reactions,
}: {
  readonly list: MessageListProps;
  readonly message: MessagePayload;
  readonly startsGroup: boolean;
  readonly reactions: readonly ReactionGroup[];
}) {
  const { runtime, ownUserId, ownName, permissions, memberNames, memberColors, mentionNames } =
    list;
  const own = message.authorId === ownUserId;
  const mirror = (list.ownSide ?? "left") === "right" && own;
  const pending = list.pendingIds.has(message.id);
  const failed = list.failedIds?.has(message.id) ?? false;
  const unsent = pending || failed;
  const text = list.decrypted.get(message.id) ?? message.body;
  const attachments = list.attachments.get(message.id) ?? [];
  const authorName = own ? "You" : (memberNames.get(message.authorId) ?? "Unknown member");
  const authorColor = memberColors?.get(message.authorId);
  const replyToId = message.replyToId ?? null;
  const replyPreview = replyToId !== null ? list.replyPreviews?.get(replyToId) : undefined;

  const scrollToOriginal = (id: string): void => {
    const node = document.getElementById(`message-${id}`);
    node?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    if (node !== null && typeof node.animate === "function") {
      node.animate(
        [{ backgroundColor: "var(--aulora-accent-soft)" }, { backgroundColor: "transparent" }],
        { duration: 1600, easing: "ease-out" },
      );
    }
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const canModerate = hasPermission(permissions, Permission.ManageMessages);
  const canEdit = own;
  const canDelete = own || canModerate;
  const canPin = hasPermission(permissions, Permission.PinMessages);
  const canReact = hasPermission(permissions, Permission.AddReactions);
  const canThread =
    list.inThread !== true &&
    hasPermission(permissions, Permission.SendInThreads) &&
    ((message.replyCount ?? 0) > 0 || hasPermission(permissions, Permission.CreateThreads));
  const openMenu = useContextMenu();

  const openContextMenu = (event: React.MouseEvent) => {
    if (unsent || editing) {
      return;
    }
    event.preventDefault();
    const items: ContextMenuItem[] = [];
    if (canReact) {
      items.push({
        id: "react",
        label: "Custom reaction",
        icon: <Icon name="smile" size={14} />,
        onSelect: () => {
          setPickerOpen(true);
        },
      });
    }
    if (list.onReplyTo !== undefined && hasPermission(permissions, Permission.SendMessages)) {
      items.push({
        id: "reply",
        label: "Reply",
        icon: <Icon name="reply" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => list.onReplyTo?.(message),
      });
    }
    if (canThread) {
      items.push({
        id: "thread",
        label: "Reply in thread",
        icon: <Icon name="thread" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => {
          list.onReply(message);
        },
      });
    }
    if (canEdit) {
      items.push({
        id: "edit",
        label: "Edit message",
        icon: <Icon name="pencil" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => {
          setDraft(text);
          setEditing(true);
        },
      });
    }
    if (canPin) {
      items.push({
        id: "pin",
        label: message.pinnedAt !== null ? "Unpin message" : "Pin message",
        icon: <Icon name="pin" size={14} />,
        onSelect: () => {
          list.onPinToggle(message);
        },
      });
    }
    if (text.trim().length > 0) {
      items.push({
        id: "copy",
        label: "Copy text",
        icon: <Icon name="file" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => {
          void navigator.clipboard.writeText(text).catch(() => undefined);
        },
      });
    }
    if (canDelete) {
      items.push({
        id: "delete",
        label: "Delete message",
        icon: <Icon name="trash" size={14} />,
        danger: true,
        separatorBefore: items.length > 0,
        onSelect: () => {
          list.onDelete(message);
        },
      });
    }
    if (items.length > 0) {
      openMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        items,
        label: `Message from ${authorName}`,
      });
    }
  };

  useEffect(() => {
    if (!confirmDelete) {
      return;
    }
    const timer = setTimeout(() => {
      setConfirmDelete(false);
    }, 4_000);
    return () => {
      clearTimeout(timer);
    };
  }, [confirmDelete]);

  const hasText = text.trim().length > 0;
  const time = messageTime(message.createdAt);
  const replyCount = message.replyCount ?? 0;

  const body = editing ? (
    <form
      className="flex w-[min(560px,100%)] flex-col gap-2 rounded-[10px] border border-accent bg-surface-2 p-2 shadow-lg shadow-black/10"
      onSubmit={(event) => {
        event.preventDefault();
        if ((draft ?? "").trim().length > 0 && draft !== undefined && draft !== text) {
          list.onEdit(message, draft);
        }
        setEditing(false);
      }}
    >
      <textarea
        aria-label="Edit message"
        // biome-ignore lint/a11y/noAutofocus: editing was explicitly requested
        autoFocus
        className="min-h-[64px] resize-none bg-transparent px-1.5 py-1 text-[14px] leading-relaxed text-text focus-visible:outline-none"
        value={draft ?? ""}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setEditing(false);
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2 text-xs">
        <span className="mr-auto pl-1.5 text-text-muted">Esc to cancel · Enter to save</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  ) : hasText ? (
    <div
      className={cn(
        "min-w-0 max-w-full whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text [overflow-wrap:anywhere]",
        unsent && "opacity-70",
      )}
    >
      <RichText
        text={text}
        mentionNames={mentionNames}
        {...(list.channelNames !== undefined ? { channelNames: list.channelNames } : {})}
        {...(list.onChannelClick !== undefined ? { onChannelClick: list.onChannelClick } : {})}
        viewerName={ownName}
      />
    </div>
  ) : null;

  const replyAuthorId = replyPreview?.authorId;
  const replyAuthorColor =
    replyAuthorId !== undefined ? memberColors?.get(replyAuthorId) : undefined;

  const replyLine = replyToId !== null && (
    <button
      type="button"
      onClick={() => {
        scrollToOriginal(replyToId);
      }}
      aria-label="Jump to replied message"
      className={cn(
        "flex min-w-0 max-w-full items-center text-left transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        mirror && "text-right",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-1 text-[12px] leading-4">
        {replyPreview !== undefined ? (
          <>
            <span
              className={cn(
                "min-w-0 truncate font-semibold",
                replyAuthorColor === undefined && "text-accent",
              )}
              style={replyAuthorColor !== undefined ? { color: replyAuthorColor } : undefined}
            >
              {replyPreview.authorName}
            </span>
            <div className="min-w-0 text-text-muted">
              <RichText
                variant="inline"
                text={replyPreview.text}
                mentionNames={list.mentionNames}
                {...(list.channelNames !== undefined ? { channelNames: list.channelNames } : {})}
                viewerName={list.ownName}
              />
            </div>
          </>
        ) : (
          <span className="truncate italic text-text-muted">Replying to a message</span>
        )}
      </div>
    </button>
  );

  const toolbar = !unsent && !editing && (
    <div
      className={cn(
        // Pinned to the far edge of the full-width row and revealed on hover or
        // keyboard focus. Mirrored own messages pin it to the left instead.
        "absolute top-0 z-20 hidden items-center gap-0.5 rounded-[9px] border border-border bg-surface-2 p-0.5 shadow-lg shadow-black/20 group-focus-within/message:flex group-hover/message:flex",
        mirror ? "left-2" : "right-2",
        pickerOpen && "flex",
      )}
    >
      {canReact && (
        <span className="relative">
          <ToolbarButton
            label="Custom reaction"
            onClick={() => {
              setPickerOpen((open) => !open);
            }}
          >
            <Icon name="smile" size={18} />
          </ToolbarButton>
          {pickerOpen && (
            <EmojiPicker
              className={cn("absolute top-full mt-1", mirror ? "left-0" : "right-0")}
              onPick={(emoji) => {
                list.onReact(message, emoji);
              }}
              onClose={() => {
                setPickerOpen(false);
              }}
            />
          )}
        </span>
      )}
      {list.onReplyTo !== undefined && hasPermission(permissions, Permission.SendMessages) && (
        <ToolbarButton label="Reply" onClick={() => list.onReplyTo?.(message)}>
          <Icon name="reply" size={18} />
        </ToolbarButton>
      )}
      {canThread && (
        <ToolbarButton
          label="Reply in thread"
          onClick={() => {
            list.onReply(message);
          }}
        >
          <Icon name="thread" size={18} />
        </ToolbarButton>
      )}
      {canEdit && (
        <ToolbarButton
          label="Edit message"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          <Icon name="pencil" size={18} />
        </ToolbarButton>
      )}
      {canPin && (
        <ToolbarButton
          label={message.pinnedAt !== null ? "Unpin message" : "Pin message"}
          active={message.pinnedAt !== null}
          onClick={() => {
            list.onPinToggle(message);
          }}
        >
          <Icon name="pin" size={18} />
        </ToolbarButton>
      )}
      {canDelete &&
        (confirmDelete ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            aria-label="Confirm delete"
            onClick={() => {
              setConfirmDelete(false);
              list.onDelete(message);
            }}
          >
            Delete?
          </Button>
        ) : (
          <ToolbarButton
            label="Delete message"
            danger
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            <Icon name="trash" size={18} />
          </ToolbarButton>
        ))}
    </div>
  );

  return (
    <article
      id={`message-${message.id}`}
      data-testid={`message-${message.id}`}
      data-message-row
      onContextMenu={openContextMenu}
      className={cn(
        "group/message relative w-full py-0.5 transition-colors",
        startsGroup ? "mt-3" : "mt-0.5",
      )}
    >
      {replyToId !== null && (
        <>
          <div className={cn("mb-1.5 flex w-full gap-2.5", mirror && "flex-row-reverse")}>
            <div className="w-8 shrink-0" />
            <div className={cn("flex min-w-0 flex-1", mirror ? "justify-end" : "justify-start")}>
              {replyLine}
            </div>
          </div>
          <svg
            aria-hidden
            viewBox="15 9 28 18"
            fill="none"
            className={cn(
              "pointer-events-none absolute top-[9px] h-[18px] w-[28px] overflow-visible",
              mirror ? "right-[15px] -scale-x-100" : "left-[15px]",
              replyAuthorColor === undefined && "text-text-muted",
            )}
            style={replyAuthorColor !== undefined ? { color: replyAuthorColor } : undefined}
          >
            <path
              d="M 16 23 L 16 18 Q 16 10 24 10 L 39 10"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </svg>
        </>
      )}
      <div className={cn("relative flex w-full gap-2.5", mirror && "flex-row-reverse")}>
        <div className="flex w-8 shrink-0 items-start justify-end pt-0.5">
          {startsGroup ? (
            <PresenceAvatar userId={message.authorId} size={32} roleColor={authorColor} />
          ) : (
            !editing && (
              <time
                className={cn(
                  "pointer-events-none hidden whitespace-nowrap text-[10px] leading-5 text-text-muted group-hover/message:block",
                  mirror ? "text-left" : "text-right",
                )}
                dateTime={new Date(message.createdAt).toISOString()}
              >
                {time}
              </time>
            )
          )}
        </div>
        <div className={cn("flex min-w-0 flex-1 flex-col", mirror ? "items-end" : "items-start")}>
          {startsGroup && (
            <div
              className={cn(
                "mb-0.5 flex min-w-0 max-w-full items-baseline gap-2",
                mirror && "flex-row-reverse",
              )}
            >
              <span
                className="min-w-0 truncate text-[13px] font-semibold text-text"
                style={authorColor !== undefined ? { color: authorColor } : undefined}
              >
                {authorName}
              </span>
              <time
                className="shrink-0 text-[11px] text-text-muted"
                dateTime={new Date(message.createdAt).toISOString()}
              >
                {time}
              </time>
              {message.pinnedAt !== null && (
                <span
                  role="img"
                  aria-label="Pinned"
                  title="Pinned"
                  className="inline-flex shrink-0 items-center text-accent"
                >
                  <Icon name="pin" size={12} align="baseline" />
                </span>
              )}
            </div>
          )}
          {body}
          {attachments.length > 0 && (
            <div className={cn("mt-1.5 flex flex-col gap-1.5", mirror && "items-end")}>
              {attachments.map((attachment) => (
                <AttachmentView key={attachment.fileId} runtime={runtime} descriptor={attachment} />
              ))}
            </div>
          )}
          {failed ? (
            <span
              className={cn(
                "mt-0.5 flex items-center gap-2 text-[11px] text-text-muted",
                mirror && "flex-row-reverse",
              )}
            >
              <span data-testid={`failed-${message.id}`} className="font-medium text-danger">
                Not sent
              </span>
              {list.onRetrySend !== undefined && (
                <button
                  type="button"
                  onClick={() => list.onRetrySend?.(message.id)}
                  className="rounded-[6px] border border-border px-1.5 py-0.5 font-semibold text-text transition hover:bg-surface-3"
                >
                  Retry
                </button>
              )}
              {list.onDiscardSend !== undefined && (
                <button
                  type="button"
                  onClick={() => list.onDiscardSend?.(message.id)}
                  className="rounded-[6px] px-1.5 py-0.5 font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
                >
                  Discard
                </button>
              )}
            </span>
          ) : pending ? (
            <span className="mt-0.5 text-[11px] text-text-muted">
              <span data-testid={`pending-${message.id}`}>Sending…</span>
            </span>
          ) : message.editedAt !== null ? (
            <span className="mt-0.5 text-[11px] text-text-muted">(edited)</span>
          ) : null}
          {reactions.length > 0 && (
            <ReactionChips
              groups={reactions}
              align={mirror ? "end" : own ? "end" : "start"}
              onToggle={(emoji) => {
                list.onReact(message, emoji);
              }}
            />
          )}
          {replyCount > 0 && list.inThread !== true && (
            <button
              type="button"
              onClick={() => {
                list.onReply(message);
              }}
              className="mt-1 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-accent transition hover:bg-accent-soft"
            >
              <Icon name="thread" size={14} />
              {replyCount === 1 ? "1 reply" : `${replyCount} replies`}
              {message.lastReplyAt != null && (
                <span className="font-normal text-text-muted">
                  · {activityLabel(message.lastReplyAt)}
                </span>
              )}
            </button>
          )}
          {toolbar}
        </div>
      </div>
    </article>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
  active = false,
  danger = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-surface-3 hover:text-text",
        active && "text-accent",
      )}
    >
      {children}
    </button>
  );
}

function TypingBubble({
  typers,
  memberNames,
  memberColors,
}: {
  readonly typers: readonly TypingRow[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string> | undefined;
}) {
  const first = typers[0];
  if (first === undefined) {
    return null;
  }
  const names = typers.map((typer) => memberNames.get(typer.userId) ?? "Someone");
  const label =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.length} people`;
  return (
    <div className="mt-3 flex animate-fade-in gap-2.5" aria-live="polite">
      <div className="w-8 shrink-0 pt-0.5">
        <PresenceAvatar
          userId={first.userId}
          size={32}
          roleColor={memberColors?.get(first.userId)}
        />
      </div>
      <div className="flex flex-col items-start">
        <span className="mb-1 text-[13px] font-semibold text-text">{label}</span>
        <span
          className="flex h-6 items-center gap-1"
          role="status"
          aria-label={`${label} ${names.length === 1 ? "is" : "are"} typing`}
        >
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-text-muted"
              style={{ animationDelay: `${dot * 160}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function groupReactions(
  reactions: readonly { userId: string; emoji: string }[],
  ownUserId: string,
): ReactionGroup[] {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    group.count += 1;
    group.mine = group.mine || reaction.userId === ownUserId;
    groups.set(reaction.emoji, group);
  }
  return [...groups.values()];
}

/** Groups a batched reactions page by message id for the timeline rows. */
function groupReactionsByMessage(
  rows: readonly MessageReactionRow[],
  ownUserId: string,
): Map<string, readonly ReactionGroup[]> {
  const byMessage = new Map<string, { userId: string; emoji: string }[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId);
    if (list === undefined) {
      byMessage.set(row.messageId, [{ userId: row.userId, emoji: row.emoji }]);
    } else {
      list.push({ userId: row.userId, emoji: row.emoji });
    }
  }
  const grouped = new Map<string, readonly ReactionGroup[]>();
  for (const [messageId, list] of byMessage) {
    grouped.set(messageId, groupReactions(list, ownUserId));
  }
  return grouped;
}
