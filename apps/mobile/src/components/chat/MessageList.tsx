/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { AttachmentDescriptor, MessagePayload } from "@aulora/core";
import { Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { impactFeedback, selectionFeedback } from "../../lib/haptics";
import { buildMessageRows, type MessageListRow } from "../../lib/message-rows";
import { MessageActionsSheet } from "./MessageActionsSheet";
import { MessageRow, type MessageRowContext, type ReplyPreview } from "./MessageRow";

export interface MessageListProps {
  readonly runtime: ChatSurfaceRuntime | undefined;
  readonly channelId: string;
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  readonly attachments: ReadonlyMap<string, readonly AttachmentDescriptor[]>;
  readonly pendingIds: ReadonlySet<string>;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly firstUnreadId: string | null;
  readonly onReply?: ((message: MessagePayload) => void) | undefined;
  /** Opens the channel behind a `#channel` mention. */
  readonly onChannelPress?: (name: string) => void;
  readonly hasOlder?: boolean;
  readonly loadingOlder?: boolean;
  readonly onLoadOlder?: (() => void) | undefined;
  /** Called when the viewer uses the jump-to-unread pill, if the list offers one. */
  readonly onJumpToFirstUnread?: () => void;
  readonly permissions?: bigint;
  readonly jumpToMessageId?: string | null;
  readonly onQuote?: (message: MessagePayload) => void;
  readonly onMemberPress?: (userId: string) => void;
}

type ListHandle = FlatList<MessageListRow>;

function indexOfMessage(rows: readonly MessageListRow[], messageId: string | null): number {
  return rows.findIndex((row) => row.kind === "message" && row.key === messageId);
}

/** How long a jumped-to message stays marked. */
const FLASH_MS = 1600;

/** Scrolling to a message and briefly marking it, from a reply line, search or pins. */
function useJump(rows: readonly MessageListRow[], requestedId: string | null) {
  const listRef = useRef<ListHandle>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  // Read the latest rows without making `jumpTo` change identity every time the
  // list updates, so the memoized row context stays stable.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    if (flashId === null) return;
    const timer = setTimeout(() => {
      setFlashId(null);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flashId]);

  // Scroll to a requested message once, when it first appears in the list.
  // Later list updates (new history, new messages) must not snap back to it.
  const requestedIndex = indexOfMessage(rows, requestedId);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (requestedId === null) {
      handled.current = null;
      return;
    }
    if (requestedIndex < 0 || handled.current === requestedId) return;
    handled.current = requestedId;
    setFlashId(requestedId);
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: requestedIndex, animated: false, viewPosition: 0.5 });
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [requestedId, requestedIndex]);

  const jumpTo = useCallback((messageId: string) => {
    const index = indexOfMessage(rowsRef.current, messageId);
    if (index < 0) return;
    selectionFeedback();
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setFlashId(messageId);
  }, []);

  return { listRef, flashId, jumpTo };
}

/** The message actions sheet and which message it is open on. */
function useActionsSheet() {
  const [visible, setVisible] = useState(false);
  // Kept after closing so the sheet's content stays put while it slides away.
  const [message, setMessage] = useState<MessagePayload>();
  const show = useCallback((next: MessagePayload) => {
    impactFeedback();
    setMessage(next);
    setVisible(true);
  }, []);
  const hide = useCallback(() => {
    setVisible(false);
  }, []);
  return { visible, message, show, hide };
}

function DaySeparator({ label }: { readonly label: string }) {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3">
      <View className="h-px flex-1 bg-border" />
      <Text size="xs" tone="muted" className="font-semibold" maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

function EmptyConversation() {
  const palette = usePalette();
  return (
    // An inverted list flips its empty state too; flip it back.
    <View className="items-center gap-2 px-8 py-16" style={{ transform: [{ scaleY: -1 }] }}>
      <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-2">
        <Icon name="message" size={24} color={palette["text-muted"]} />
      </View>
      <Text tone="muted" className="text-center">
        Nothing here yet. Say something to get it started.
      </Text>
    </View>
  );
}

function UnreadPill({ onPress }: { readonly onPress: () => void }) {
  const palette = usePalette();
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 top-2 items-center">
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="min-h-9 flex-row items-center gap-1.5 rounded-pill bg-accent px-4 active:opacity-80"
        style={{
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text size="xs" className="font-semibold" style={{ color: palette["on-accent"] }}>
          Jump to first unread
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The maps and ids a row needs to render itself. Built once per data change so
 * the memoized rows below can compare a single stable reference.
 */
interface RowData {
  readonly messagesById: ReadonlyMap<string, MessagePayload>;
  readonly decrypted: ReadonlyMap<string, string>;
  readonly attachments: ReadonlyMap<string, readonly AttachmentDescriptor[]>;
  readonly pendingIds: ReadonlySet<string>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly ownUserId: string;
}

/** Shared empty attachment list, so absent rows keep a stable reference. */
const EMPTY_ATTACHMENTS: readonly AttachmentDescriptor[] = [];

/** What the message a reply answers looks like from here, or `null` when it is not a reply. */
function replyPreview(data: RowData, message: MessagePayload): ReplyPreview | null {
  const replyToId = message.replyToId;
  if (replyToId === null || replyToId === undefined) return null;
  const original = data.messagesById.get(replyToId);
  const deleted = original !== undefined && original.deletedAt !== null;
  return {
    messageId: replyToId,
    authorName: original === undefined ? undefined : data.memberNames.get(original.authorId),
    authorColor: original === undefined ? undefined : data.memberColors.get(original.authorId),
    text: deleted ? undefined : data.decrypted.get(replyToId),
  };
}

function systemActorName(data: RowData, actorId: string | undefined): string {
  if (actorId === undefined) return "Someone";
  if (actorId === data.ownUserId) return "You";
  return data.memberNames.get(actorId) ?? "Someone";
}

/** The quiet "<actor> pinned a message" line, with a jump to the pinned row. */
function SystemNotice({
  actorName,
  onJump,
}: {
  readonly actorName: string;
  readonly onJump: () => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-2 px-4 py-1">
      <Icon name="pin" size={12} color={palette["text-muted"]} />
      <Text size="xs" tone="muted" maxFontSizeMultiplier={1.4}>
        {actorName} pinned a{" "}
        <Text
          size="xs"
          tone="muted"
          className="underline"
          accessibilityRole="button"
          accessibilityLabel="Jump to the pinned message"
          onPress={onJump}
        >
          message
        </Text>
      </Text>
    </View>
  );
}

interface RowItemProps {
  readonly row: MessageListRow;
  readonly data: RowData;
  readonly context: MessageRowContext;
  readonly highlighted: boolean;
}

const RowItem = memo(function RowItem({ row, data, context, highlighted }: RowItemProps) {
  const message = row.kind === "message" ? row.message : undefined;
  const reply = useMemo(
    () => (message === undefined ? null : replyPreview(data, message)),
    [data, message],
  );
  if (row.kind === "day") return <DaySeparator label={row.label} />;
  if (row.kind === "system") {
    const actorName = systemActorName(data, row.actorId);
    return (
      <SystemNotice
        actorName={actorName}
        onJump={() => {
          if (row.targetId !== undefined) context.onJumpToReply(row.targetId);
        }}
      />
    );
  }
  const { message: current } = row;
  return (
    <MessageRow
      context={context}
      message={current}
      grouped={row.grouped}
      highlighted={highlighted}
      text={data.decrypted.get(current.id)}
      reply={reply}
      attachments={data.attachments.get(current.id) ?? EMPTY_ATTACHMENTS}
      pending={data.pendingIds.has(current.id)}
      authorName={data.memberNames.get(current.authorId) ?? current.authorId}
      authorColor={data.memberColors.get(current.authorId)}
    />
  );
});

/** The part of a row's context that only depends on who is in the conversation. */
function useNames(props: MessageListProps) {
  const { memberNames, channelNames, ownUserId } = props;
  const mentionNames = useMemo(() => [...memberNames.values()], [memberNames]);
  const channelNameList = useMemo(
    () => (channelNames === undefined ? [] : [...channelNames.values()]),
    [channelNames],
  );
  return {
    viewerName: memberNames.get(ownUserId) ?? "You",
    mentionNames,
    channelNames: channelNameList,
  };
}

/**
 * Realtime message list, newest at the bottom. Consecutive messages from one
 * author collapse into a block; tap or long-press a message for its actions.
 */
export function MessageList(props: MessageListProps) {
  const { runtime, messages, firstUnreadId, hasOlder = false, onReply, onQuote } = props;
  // The reply index is built in the same pass as the rows, so a reply preview is
  // an O(1) lookup instead of a scan of every loaded message.
  const { rows, messagesById } = useMemo(() => {
    const byId = new Map<string, MessagePayload>();
    for (const message of messages) byId.set(message.id, message);
    return { rows: buildMessageRows(messages), messagesById: byId };
  }, [messages]);
  const { listRef, flashId, jumpTo } = useJump(rows, props.jumpToMessageId ?? null);
  const {
    visible: sheetVisible,
    message: sheetMessage,
    show: openActions,
    hide: closeActions,
  } = useActionsSheet();
  const { viewerName, mentionNames, channelNames } = useNames(props);

  // The parent recreates its callbacks on every render; read them through a ref
  // so the row context below stays referentially stable and memoized rows only
  // re-render when their own data changes.
  const latest = useRef(props);
  latest.current = props;
  const openReply = useCallback((message: MessagePayload) => {
    latest.current.onReply?.(message);
  }, []);
  const pressMember = useCallback((userId: string) => {
    latest.current.onMemberPress?.(userId);
  }, []);
  const pressChannel = useCallback((name: string) => {
    latest.current.onChannelPress?.(name);
  }, []);
  const hasReply = props.onReply !== undefined;
  const hasMemberPress = props.onMemberPress !== undefined;
  const hasChannelPress = props.onChannelPress !== undefined;

  const context = useMemo<MessageRowContext>(
    () => ({
      runtime,
      channelId: props.channelId,
      permissions: props.permissions ?? 0n,
      ownUserId: props.ownUserId,
      viewerName,
      mentionNames,
      channelNames,
      onActions: openActions,
      onJumpToReply: jumpTo,
      ...(hasReply ? { onReply: openReply } : {}),
      ...(hasMemberPress ? { onMemberPress: pressMember } : {}),
      ...(hasChannelPress ? { onChannelPress: pressChannel } : {}),
    }),
    [
      runtime,
      props.channelId,
      props.permissions,
      props.ownUserId,
      viewerName,
      mentionNames,
      channelNames,
      openActions,
      jumpTo,
      hasReply,
      hasMemberPress,
      hasChannelPress,
      openReply,
      pressMember,
      pressChannel,
    ],
  );

  const data = useMemo<RowData>(
    () => ({
      messagesById,
      decrypted: props.decrypted,
      attachments: props.attachments,
      pendingIds: props.pendingIds,
      memberNames: props.memberNames,
      memberColors: props.memberColors,
      ownUserId: props.ownUserId,
    }),
    [
      messagesById,
      props.decrypted,
      props.attachments,
      props.pendingIds,
      props.memberNames,
      props.memberColors,
      props.ownUserId,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { readonly item: MessageListRow }) => (
      <RowItem
        row={item}
        data={data}
        context={context}
        highlighted={item.kind === "message" && item.message.id === flashId}
      />
    ),
    [data, context, flashId],
  );
  const keyExtractor = useCallback((row: MessageListRow) => row.key, []);

  return (
    <View className="flex-1">
      <FlatList
        ref={listRef}
        inverted
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        }}
        className="flex-1"
        data={rows}
        keyExtractor={keyExtractor}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 8 }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasOlder && props.loadingOlder !== true) props.onLoadOlder?.();
        }}
        ListFooterComponent={hasOlder ? <OlderSpinner /> : null}
        ListEmptyComponent={<EmptyConversation />}
        renderItem={renderItem}
      />
      {firstUnreadId !== null && indexOfMessage(rows, firstUnreadId) >= 0 && (
        <UnreadPill
          onPress={() => {
            jumpTo(firstUnreadId);
            props.onJumpToFirstUnread?.();
          }}
        />
      )}
      {sheetMessage !== undefined && runtime !== undefined && (
        <MessageActionsSheet
          visible={sheetVisible}
          runtime={runtime}
          message={sheetMessage}
          text={props.decrypted.get(sheetMessage.id) ?? ""}
          authorName={props.memberNames.get(sheetMessage.authorId) ?? "Member"}
          ownUserId={props.ownUserId}
          permissions={props.permissions ?? 0n}
          onClose={closeActions}
          onReply={
            onReply === undefined
              ? undefined
              : () => {
                  onReply(sheetMessage);
                }
          }
          onQuote={
            onQuote === undefined
              ? undefined
              : () => {
                  onQuote(sheetMessage);
                }
          }
        />
      )}
    </View>
  );
}

function OlderSpinner() {
  return (
    <View className="items-center py-4">
      <Spinner size={18} label="Loading earlier messages" />
    </View>
  );
}
