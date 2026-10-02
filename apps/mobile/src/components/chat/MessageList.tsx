import type { AttachmentDescriptor, MessagePayload } from "@aulora/core";
import {
  dayLabel,
  GROUP_WINDOW_MS,
  hasPermission,
  messageTime,
  Permission,
  startOfLocalDay,
} from "@aulora/core";
import { Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { impactFeedback, selectionFeedback } from "../../lib/haptics";
import { AttachmentView } from "./AttachmentView";
import { MemberAvatar } from "./MemberAvatar";
import { MessageActionsSheet } from "./MessageActionsSheet";
import { RichText } from "./RichText";

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
  readonly onJumpToFirstUnread: () => void;
  readonly permissions?: bigint;
  readonly jumpToMessageId?: string | null;
  readonly onQuote?: (message: MessagePayload) => void;
  readonly onMemberPress?: (userId: string) => void;
}

/** The message a reply answers, as far as this client has it loaded. */
interface ReplyPreview {
  readonly messageId: string;
  readonly authorName: string | undefined;
  readonly authorColor: string | undefined;
  /** Missing when the original is not loaded or was deleted. */
  readonly text: string | undefined;
}

type Row =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | {
      readonly kind: "message";
      readonly key: string;
      readonly message: MessagePayload;
      /** Continues the previous message's author block: no avatar or name. */
      readonly grouped: boolean;
    };

/**
 * Realtime message list, newest at the bottom. Consecutive messages from one
 * author collapse into a block; long-press a message for its actions.
 */
export function MessageList({
  runtime,
  channelId,
  messages,
  decrypted,
  attachments,
  pendingIds,
  ownUserId,
  memberNames,
  memberColors,
  channelNames,
  firstUnreadId,
  onReply,
  onChannelPress,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  onJumpToFirstUnread,
  permissions = 0n,
  jumpToMessageId,
  onQuote,
  onMemberPress,
}: MessageListProps) {
  const palette = usePalette();
  const listRef = useRef<FlatList<Row>>(null);
  const [actionMessage, setActionMessage] = useState<MessagePayload | null>(null);
  // Kept after closing so the sheet's content stays put while it slides away.
  const [sheetMessage, setSheetMessage] = useState<MessagePayload | null>(null);
  const viewerName = memberNames.get(ownUserId) ?? "You";
  const mentionNames = useMemo(() => [...memberNames.values()], [memberNames]);
  const channelNameList = useMemo(
    () => (channelNames === undefined ? [] : [...channelNames.values()]),
    [channelNames],
  );
  // Newest first: the list is inverted so it opens on the latest message.
  const rows = useMemo<Row[]>(() => {
    const output: Row[] = [];
    let previous: MessagePayload | undefined;
    for (const message of messages) {
      const day = startOfLocalDay(message.createdAt);
      const newDay = previous === undefined || startOfLocalDay(previous.createdAt) !== day;
      if (newDay) output.push({ kind: "day", key: `day-${day}`, label: dayLabel(day) });
      output.push({
        kind: "message",
        key: message.id,
        message,
        grouped:
          !newDay &&
          previous !== undefined &&
          previous.authorId === message.authorId &&
          previous.deletedAt === null &&
          message.createdAt - previous.createdAt < GROUP_WINDOW_MS &&
          (message.replyToId === null || message.replyToId === undefined),
      });
      previous = message;
    }
    return output.reverse();
  }, [messages]);

  const jumpTarget = jumpToMessageId ?? firstUnreadId;
  const jumpIndex = rows.findIndex((row) => row.kind === "message" && row.key === jumpTarget);
  function jump() {
    if (jumpIndex >= 0)
      listRef.current?.scrollToIndex({ index: jumpIndex, animated: true, viewPosition: 0.5 });
  }
  // A jumped-to message flashes briefly, whether reached from a reply line, search or pins.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (flashId === null) return;
    const timer = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);
  // Scroll to a requested message once, when it first appears in the list.
  // Later list updates (new history, new messages) must not snap back to it.
  const handledJump = useRef<string | null>(null);
  useEffect(() => {
    if (jumpToMessageId === undefined || jumpToMessageId === null) {
      handledJump.current = null;
      return;
    }
    if (jumpIndex < 0 || handledJump.current === jumpToMessageId) return;
    handledJump.current = jumpToMessageId;
    setFlashId(jumpToMessageId);
    const timer = setTimeout(
      () =>
        listRef.current?.scrollToIndex({ index: jumpIndex, animated: false, viewPosition: 0.5 }),
      100,
    );
    return () => clearTimeout(timer);
  }, [jumpToMessageId, jumpIndex]);

  function jumpToMessage(messageId: string) {
    const index = rows.findIndex((row) => row.kind === "message" && row.key === messageId);
    if (index < 0) return;
    selectionFeedback();
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setFlashId(messageId);
  }
  function replyPreviewFor(message: MessagePayload): ReplyPreview | null {
    const replyToId = message.replyToId;
    if (replyToId === null || replyToId === undefined) return null;
    const original = messages.find((entry) => entry.id === replyToId);
    const text = decrypted.get(replyToId);
    return {
      messageId: replyToId,
      authorName: original === undefined ? undefined : memberNames.get(original.authorId),
      authorColor: original === undefined ? undefined : memberColors.get(original.authorId),
      text: original?.deletedAt != null ? undefined : text,
    };
  }

  function openActions(message: MessagePayload) {
    impactFeedback();
    setSheetMessage(message);
    setActionMessage(message);
  }

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
          if (hasOlder && !loadingOlder) onLoadOlder?.();
        }}
        ListFooterComponent={
          hasOlder ? (
            <View className="items-center py-4">
              <Spinner size={18} label="Loading earlier messages" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          // An inverted list flips its empty state too; flip it back.
          <View className="items-center gap-2 px-8 py-16" style={{ transform: [{ scaleY: -1 }] }}>
            <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-2">
              <Icon name="message" size={24} color={palette["text-muted"]} />
            </View>
            <Text tone="muted" className="text-center">
              Nothing here yet. Say something to get it started.
            </Text>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === "day" ? (
            <View className="flex-row items-center gap-3 px-4 py-3">
              <View className="h-px flex-1 bg-border" />
              <Text size="xs" tone="muted" className="font-semibold" maxFontSizeMultiplier={1.4}>
                {item.label}
              </Text>
              <View className="h-px flex-1 bg-border" />
            </View>
          ) : (
            <MessageRow
              runtime={runtime}
              channelId={channelId}
              message={item.message}
              grouped={item.grouped}
              highlighted={item.message.id === flashId}
              text={decrypted.get(item.message.id)}
              reply={replyPreviewFor(item.message)}
              onJumpToReply={jumpToMessage}
              attachments={attachments.get(item.message.id) ?? []}
              pending={pendingIds.has(item.message.id)}
              permissions={permissions}
              ownUserId={ownUserId}
              authorName={memberNames.get(item.message.authorId) ?? item.message.authorId}
              authorColor={memberColors.get(item.message.authorId)}
              viewerName={viewerName}
              mentionNames={mentionNames}
              channelNames={channelNameList}
              onActions={openActions}
              onMemberPress={onMemberPress}
              onReply={onReply}
              onChannelPress={onChannelPress}
            />
          )
        }
      />
      {firstUnreadId !== null && jumpIndex >= 0 && (
        <View pointerEvents="box-none" className="absolute inset-x-0 top-2 items-center">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              selectionFeedback();
              jump();
              onJumpToFirstUnread();
            }}
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
      )}
      {sheetMessage !== null && runtime !== undefined && (
        <MessageActionsSheet
          visible={actionMessage !== null}
          runtime={runtime}
          message={sheetMessage}
          text={decrypted.get(sheetMessage.id) ?? ""}
          authorName={memberNames.get(sheetMessage.authorId) ?? "Member"}
          ownUserId={ownUserId}
          permissions={permissions}
          onClose={() => setActionMessage(null)}
          onReply={onReply === undefined ? undefined : () => onReply(sheetMessage)}
          onQuote={onQuote === undefined ? undefined : () => onQuote(sheetMessage)}
        />
      )}
    </View>
  );
}

function MessageRow({
  runtime,
  channelId,
  message,
  grouped,
  highlighted,
  text,
  reply,
  onJumpToReply,
  attachments,
  pending,
  permissions,
  ownUserId,
  authorName,
  authorColor,
  viewerName,
  mentionNames,
  channelNames,
  onReply,
  onActions,
  onMemberPress,
  onChannelPress,
}: {
  runtime: ChatSurfaceRuntime | undefined;
  channelId: string;
  message: MessagePayload;
  grouped: boolean;
  highlighted: boolean;
  text: string | undefined;
  reply: ReplyPreview | null;
  onJumpToReply(messageId: string): void;
  attachments: readonly AttachmentDescriptor[];
  pending: boolean;
  permissions: bigint;
  ownUserId: string;
  authorName: string;
  authorColor: string | undefined;
  viewerName: string;
  mentionNames: readonly string[];
  channelNames: readonly string[];
  onReply?: ((message: MessagePayload) => void) | undefined;
  onActions(message: MessagePayload): void;
  onMemberPress?: ((userId: string) => void) | undefined;
  onChannelPress?: ((name: string) => void) | undefined;
}) {
  const palette = usePalette();
  if (message.deletedAt !== null) {
    return (
      <View className="flex-row items-center gap-3 px-4 py-1">
        <View className="w-9 items-center">
          <Icon name="trash" size={14} color={palette["text-muted"]} />
        </View>
        <Text size="sm" tone="muted" className="italic">
          This message was deleted.
        </Text>
      </View>
    );
  }

  const replies = message.replyCount ?? 0;
  return (
    <Pressable
      accessibilityLabel={`${authorName}, ${messageTime(message.createdAt)}. ${text ?? ""}`}
      accessibilityHint="Opens reactions, replies and more"
      disabled={pending}
      delayLongPress={280}
      onPress={() => onActions(message)}
      onLongPress={() => onActions(message)}
      className={`px-4 active:bg-surface-1 ${grouped ? "py-0.5" : "pb-0.5 pt-2.5"} ${
        highlighted ? "bg-accent-soft" : ""
      } ${pending ? "opacity-60" : ""}`}
    >
      {reply !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            reply.authorName === undefined
              ? "Jump to replied message"
              : `Reply to ${reply.authorName}. Jump to that message`
          }
          hitSlop={{ top: 10, bottom: 6 }}
          onPress={() => onJumpToReply(reply.messageId)}
          className="mb-1 flex-row items-center active:opacity-70"
        >
          {/* The elbow that ties the reply line to this message's avatar, as on web. */}
          <Svg width={48} height={16} viewBox="0 0 48 16" fill="none">
            <Path
              d="M 18 16 L 18 13 Q 18 8 23 8 L 44 8"
              stroke={reply.authorColor ?? palette["text-muted"]}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </Svg>
          <Text size="xs" numberOfLines={1} className="min-w-0 flex-1" maxFontSizeMultiplier={1.6}>
            {reply.text === undefined ? (
              <Text size="xs" tone="muted" className="italic">
                Replying to a message
              </Text>
            ) : (
              <>
                <Text
                  size="xs"
                  className="font-semibold"
                  style={{ color: reply.authorColor ?? palette.accent }}
                >
                  {reply.authorName ?? "Member"}
                </Text>
                <Text size="xs" tone="muted">
                  {"  "}
                  {reply.text.replace(/\s+/g, " ").trim()}
                </Text>
              </>
            )}
          </Text>
        </Pressable>
      )}
      <View className="flex-row gap-3">
        {grouped ? (
          <View className="w-9" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Profile of ${authorName}`}
            disabled={onMemberPress === undefined}
            hitSlop={6}
            onPress={() => onMemberPress?.(message.authorId)}
            className="pt-0.5"
          >
            <MemberAvatar userId={message.authorId} size={36} roleColor={authorColor} />
          </Pressable>
        )}
        <View className="min-w-0 flex-1 gap-1">
          {!grouped && (
            <View className="flex-row flex-wrap items-baseline gap-x-2">
              <Text
                size="sm"
                className="font-semibold"
                style={authorColor !== undefined ? { color: authorColor } : undefined}
              >
                {authorName}
              </Text>
              <Text size="xs" tone="muted">
                {messageTime(message.createdAt)}
              </Text>
              {message.pinnedAt !== null && <Icon name="pin" size={12} color={palette.accent} />}
            </View>
          )}
          {text !== undefined ? (
            <RichText
              text={text}
              mentionNames={mentionNames}
              channelNames={channelNames}
              viewerName={viewerName}
              onChannelPress={onChannelPress}
            />
          ) : (
            !pending && (
              <Text size="sm" tone="muted">
                Unable to load this message.
              </Text>
            )
          )}
          {message.editedAt !== null && (
            <Text size="xs" tone="muted">
              edited
            </Text>
          )}
          {attachments.map((attachment) => (
            <AttachmentView key={attachment.fileId} runtime={runtime} descriptor={attachment} />
          ))}
          {pending && (
            <Text size="xs" tone="muted">
              Sending…
            </Text>
          )}
          {runtime !== undefined && (
            <ReactionRow
              runtime={runtime}
              channelId={channelId}
              messageId={message.id}
              ownUserId={ownUserId}
              onAdd={() => onActions(message)}
              pending={pending}
              canReact={hasPermission(permissions, Permission.AddReactions)}
            />
          )}
          {replies > 0 && onReply !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open thread, ${replies} ${replies === 1 ? "reply" : "replies"}`}
              hitSlop={8}
              onPress={() => onReply(message)}
              className="flex-row items-center gap-1.5 self-start rounded-pill bg-surface-2 px-3 py-1.5 active:opacity-70"
            >
              <Icon name="thread" size={14} color={palette.accent} />
              <Text size="xs" tone="accent" className="font-semibold">
                {replies} {replies === 1 ? "reply" : "replies"}
              </Text>
              <Icon name="chevron-right" size={14} color={palette["text-muted"]} />
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

function ReactionRow({
  runtime,
  channelId,
  messageId,
  ownUserId,
  onAdd,
  pending,
  canReact,
}: {
  runtime: ChatSurfaceRuntime;
  channelId: string;
  messageId: string;
  ownUserId: string;
  onAdd: () => void;
  pending: boolean;
  canReact: boolean;
}) {
  const palette = usePalette();
  const [groups, setGroups] = useState<readonly ReactionGroup[]>([]);

  useEffect(() => {
    const off = runtime.subscriptions.watchReactions(messageId, (rows) => {
      void runtime.session.loadReactions(channelId, messageId, rows).then((resolved) => {
        setGroups(groupReactions(resolved, ownUserId));
      });
    });
    return () => off();
  }, [runtime, channelId, messageId, ownUserId]);

  function toggle(emoji: string) {
    selectionFeedback();
    void runtime.session
      .toggleReaction(channelId, messageId, emoji)
      .catch(() => Alert.alert("Couldn't update reaction", "Try again when you are connected."));
  }

  if (groups.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5 pt-0.5">
      {groups.map((group) => (
        <Pressable
          key={group.emoji}
          accessibilityRole="button"
          disabled={pending || !canReact}
          accessibilityLabel={`${group.emoji} ${group.count}`}
          accessibilityState={{ selected: group.mine }}
          hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
          className={`h-8 flex-row items-center gap-1 rounded-pill border px-2.5 active:opacity-70 ${
            group.mine ? "border-accent bg-accent-soft" : "border-transparent bg-surface-2"
          }`}
          onPress={() => toggle(group.emoji)}
        >
          <Text size="sm" maxFontSizeMultiplier={1.4}>
            {group.emoji}
          </Text>
          <Text
            size="xs"
            tone={group.mine ? "accent" : "muted"}
            className="font-semibold"
            maxFontSizeMultiplier={1.4}
          >
            {group.count}
          </Text>
        </Pressable>
      ))}
      {canReact && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add reaction"
          disabled={pending}
          hitSlop={8}
          className="h-8 w-9 items-center justify-center rounded-pill bg-surface-2 active:opacity-70"
          onPress={onAdd}
        >
          <Icon name="smile" size={16} color={palette["text-muted"]} />
        </Pressable>
      )}
    </View>
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
