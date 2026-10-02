/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { AttachmentDescriptor, MessagePayload } from "@aulora/core";
import { Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
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

  function jumpTo(messageId: string) {
    const index = indexOfMessage(rows, messageId);
    if (index < 0) return;
    selectionFeedback();
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setFlashId(messageId);
  }

  return { listRef, flashId, jumpTo };
}

/** The message actions sheet and which message it is open on. */
function useActionsSheet() {
  const [visible, setVisible] = useState(false);
  // Kept after closing so the sheet's content stays put while it slides away.
  const [message, setMessage] = useState<MessagePayload>();
  function show(next: MessagePayload) {
    impactFeedback();
    setMessage(next);
    setVisible(true);
  }
  function hide() {
    setVisible(false);
  }
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

/** What the message a reply answers looks like from here, or `null` when it is not a reply. */
function replyPreview(props: MessageListProps, message: MessagePayload): ReplyPreview | null {
  const replyToId = message.replyToId;
  if (replyToId === null || replyToId === undefined) return null;
  const original = props.messages.find((entry) => entry.id === replyToId);
  const deleted = original !== undefined && original.deletedAt !== null;
  return {
    messageId: replyToId,
    authorName: original === undefined ? undefined : props.memberNames.get(original.authorId),
    authorColor: original === undefined ? undefined : props.memberColors.get(original.authorId),
    text: deleted ? undefined : props.decrypted.get(replyToId),
  };
}

interface RowItemProps {
  readonly row: MessageListRow;
  readonly list: MessageListProps;
  readonly context: MessageRowContext;
  readonly flashId: string | null;
}

function RowItem({ row, list, context, flashId }: RowItemProps) {
  if (row.kind === "day") return <DaySeparator label={row.label} />;
  const { message } = row;
  return (
    <MessageRow
      context={context}
      message={message}
      grouped={row.grouped}
      highlighted={message.id === flashId}
      text={list.decrypted.get(message.id)}
      reply={replyPreview(list, message)}
      attachments={list.attachments.get(message.id) ?? []}
      pending={list.pendingIds.has(message.id)}
      authorName={list.memberNames.get(message.authorId) ?? message.authorId}
      authorColor={list.memberColors.get(message.authorId)}
    />
  );
}

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
  const rows = useMemo(() => buildMessageRows(messages), [messages]);
  const { listRef, flashId, jumpTo } = useJump(rows, props.jumpToMessageId ?? null);
  const sheet = useActionsSheet();
  const names = useNames(props);
  const context: MessageRowContext = {
    ...names,
    runtime,
    channelId: props.channelId,
    permissions: props.permissions ?? 0n,
    ownUserId: props.ownUserId,
    onActions: sheet.show,
    onJumpToReply: jumpTo,
    onReply,
    onMemberPress: props.onMemberPress,
    onChannelPress: props.onChannelPress,
  };
  const sheetMessage = sheet.message;

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
        keyExtractor={(row) => row.key}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 8 }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasOlder && props.loadingOlder !== true) props.onLoadOlder?.();
        }}
        ListFooterComponent={hasOlder ? <OlderSpinner /> : null}
        ListEmptyComponent={<EmptyConversation />}
        renderItem={({ item }) => (
          <RowItem row={item} list={props} context={context} flashId={flashId} />
        )}
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
          visible={sheet.visible}
          runtime={runtime}
          message={sheetMessage}
          text={props.decrypted.get(sheetMessage.id) ?? ""}
          authorName={props.memberNames.get(sheetMessage.authorId) ?? "Member"}
          ownUserId={props.ownUserId}
          permissions={props.permissions ?? 0n}
          onClose={sheet.hide}
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
