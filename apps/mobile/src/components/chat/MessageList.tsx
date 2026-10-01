import type { AttachmentDescriptor, MessagePayload } from "@aulora/core";
import { gridDays, hasPermission, Permission } from "@aulora/core";
import { Button, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
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

type Row =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | { readonly kind: "message"; readonly key: string; readonly message: MessagePayload };

/** Flat, realtime, plaintext message list with day separators. */
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
  const listRef = useRef<FlatList<Row>>(null);
  const [actionMessage, setActionMessage] = useState<MessagePayload | null>(null);
  const viewerName = memberNames.get(ownUserId) ?? "You";
  const mentionNames = useMemo(() => [...memberNames.values()], [memberNames]);
  const channelNameList = useMemo(
    () => (channelNames === undefined ? [] : [...channelNames.values()]),
    [channelNames],
  );
  const rows = useMemo<Row[]>(() => {
    const output: Row[] = [];
    for (const [day, dayMessages] of gridDays(messages)) {
      output.push({ kind: "day", key: `day-${day}`, label: new Date(day).toDateString() });
      for (const message of dayMessages) {
        output.push({ kind: "message", key: message.id, message });
      }
    }
    return output;
  }, [messages]);

  const jumpTarget = jumpToMessageId ?? firstUnreadId;
  const jumpIndex = rows.findIndex((row) => row.kind === "message" && row.key === jumpTarget);
  function jump() {
    if (jumpIndex >= 0)
      listRef.current?.scrollToIndex({ index: jumpIndex, animated: false, viewPosition: 0.3 });
  }
  useEffect(() => {
    if (jumpToMessageId === undefined || jumpToMessageId === null || jumpIndex < 0) return;
    const timer = setTimeout(
      () =>
        listRef.current?.scrollToIndex({ index: jumpIndex, animated: false, viewPosition: 0.3 }),
      100,
    );
    return () => clearTimeout(timer);
  }, [jumpToMessageId, jumpIndex]);
  return (
    <>
      <FlatList
        ref={listRef}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        }}
        className="flex-1"
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}
        ListHeaderComponent={
          <View className="gap-2">
            {hasOlder && (
              <Button variant="secondary" loading={loadingOlder} onPress={onLoadOlder}>
                Load earlier messages
              </Button>
            )}
            {firstUnreadId !== null ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  jump();
                  onJumpToFirstUnread();
                }}
                className="mb-2 min-h-12 justify-center self-start rounded-pill bg-accent-soft px-3 py-1"
              >
                <Text size="xs" tone="accent">
                  Jump to first unread
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) =>
          item.kind === "day" ? (
            <Text size="xs" tone="muted" mono className="py-2 text-center">
              {item.label}
            </Text>
          ) : (
            <MessageRow
              runtime={runtime}
              channelId={channelId}
              message={item.message}
              text={decrypted.get(item.message.id)}
              quotedText={
                item.message.replyToId !== null && item.message.replyToId !== undefined
                  ? decrypted.get(item.message.replyToId)
                  : undefined
              }
              quotedAuthor={
                item.message.replyToId !== null && item.message.replyToId !== undefined
                  ? memberNames.get(
                      messages.find((entry) => entry.id === item.message.replyToId)?.authorId ?? "",
                    )
                  : undefined
              }
              attachments={attachments.get(item.message.id) ?? []}
              pending={pendingIds.has(item.message.id)}
              permissions={permissions}
              ownUserId={ownUserId}
              authorName={memberNames.get(item.message.authorId) ?? item.message.authorId}
              authorColor={memberColors.get(item.message.authorId)}
              viewerName={viewerName}
              mentionNames={mentionNames}
              channelNames={channelNameList}
              onActions={() => setActionMessage(item.message)}
              onMemberPress={onMemberPress}
              onReply={onReply}
              onChannelPress={onChannelPress}
            />
          )
        }
      />
      {actionMessage !== null && runtime !== undefined && (
        <MessageActionsSheet
          runtime={runtime}
          message={actionMessage}
          text={decrypted.get(actionMessage.id) ?? ""}
          ownUserId={ownUserId}
          permissions={permissions}
          onClose={() => setActionMessage(null)}
          onReply={onReply === undefined ? undefined : () => onReply(actionMessage)}
          onQuote={onQuote === undefined ? undefined : () => onQuote(actionMessage)}
        />
      )}
    </>
  );
}

function MessageRow({
  runtime,
  channelId,
  message,
  text,
  quotedText,
  quotedAuthor,
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
  text: string | undefined;
  quotedText: string | undefined;
  quotedAuthor: string | undefined;
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
  onActions(): void;
  onMemberPress?: ((userId: string) => void) | undefined;
  onChannelPress?: ((name: string) => void) | undefined;
}) {
  const palette = usePalette();
  if (message.deletedAt !== null) {
    return (
      <View className="rounded-input bg-surface-2/50 px-3 py-2">
        <Text size="sm" tone="muted" className="italic">
          This message was deleted.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-row gap-2 rounded-input px-2 py-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Profile of ${authorName}`}
        disabled={onMemberPress === undefined}
        onPress={() => onMemberPress?.(message.authorId)}
        className="min-h-12 min-w-12 items-center"
      >
        <MemberAvatar userId={message.authorId} size={32} roleColor={authorColor} />
      </Pressable>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-baseline gap-2">
          <Text size="sm" className="font-medium">
            {authorName}
          </Text>
          <Text size="xs" tone="muted" mono>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          {message.editedAt !== null && (
            <Text size="xs" tone="muted" mono>
              (edited)
            </Text>
          )}
          {message.pinnedAt !== null && (
            <Text size="xs" tone="accent" mono>
              pinned
            </Text>
          )}
        </View>
        {quotedText !== undefined && (
          <View className="mb-0.5 flex-row items-stretch gap-2 rounded-input bg-surface-2 px-2 py-1">
            <View className="w-0.5 rounded-pill" style={{ backgroundColor: palette.accent }} />
            <View className="min-w-0 flex-1">
              {quotedAuthor !== undefined && (
                <Text size="xs" className="font-medium">
                  {quotedAuthor}
                </Text>
              )}
              <RichText
                text={quotedText}
                mentionNames={mentionNames}
                channelNames={channelNames}
                viewerName={viewerName}
                onChannelPress={onChannelPress}
              />
            </View>
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
            onReply={onReply === undefined ? undefined : () => onReply(message)}
            onActions={onActions}
            pending={pending}
            canReact={hasPermission(permissions, Permission.AddReactions)}
          />
        )}
      </View>
    </View>
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
  onReply,
  onActions,
  pending,
  canReact,
}: {
  runtime: ChatSurfaceRuntime;
  channelId: string;
  messageId: string;
  ownUserId: string;
  onReply?: (() => void) | undefined;
  onActions: () => void;
  pending: boolean;
  canReact: boolean;
}) {
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
    void runtime.session
      .toggleReaction(channelId, messageId, emoji)
      .catch(() => Alert.alert("Couldn't update reaction", "Try again when you are connected."));
  }

  return (
    <View className="mt-0.5 flex-row flex-wrap gap-1">
      {groups.map((group) => (
        <Pressable
          key={group.emoji}
          accessibilityRole="button"
          disabled={pending || !canReact}
          accessibilityLabel={`${group.emoji} ${group.count}`}
          accessibilityState={{ selected: group.mine }}
          className={
            group.mine
              ? "min-h-12 min-w-12 items-center justify-center rounded-pill border border-accent bg-accent-soft px-2 py-0.5"
              : "min-h-12 min-w-12 items-center justify-center rounded-pill border border-border bg-surface-3 px-2 py-0.5"
          }
          onPress={() => toggle(group.emoji)}
        >
          <Text size="xs">
            {group.emoji} {group.count}
          </Text>
        </Pressable>
      ))}
      {onReply !== undefined && (
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          accessibilityLabel="Reply in thread"
          className="min-h-12 justify-center px-2"
          onPress={onReply}
        >
          <Text size="xs" tone="muted">
            Reply
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Message actions"
        disabled={pending}
        className="min-h-12 justify-center px-3"
        onPress={onActions}
      >
        <Text size="sm" tone="muted">
          More
        </Text>
      </Pressable>
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
