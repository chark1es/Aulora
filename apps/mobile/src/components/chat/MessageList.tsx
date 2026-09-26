import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import type { AttachmentDescriptor, MessagePayload } from "@aulora/core";
import { gridDays } from "@aulora/core";
import { Text } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type { MobileChatRuntime } from "../../lib/chat-runtime";
import { AttachmentView } from "./AttachmentView";

export interface MessageListProps {
  readonly runtime: MobileChatRuntime | undefined;
  readonly channelId: string;
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  readonly attachments: ReadonlyMap<string, readonly AttachmentDescriptor[]>;
  readonly pendingIds: ReadonlySet<string>;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly firstUnreadId: string | null;
  readonly onReply: (message: MessagePayload) => void;
  readonly onJumpToFirstUnread: () => void;
}

type Row =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | { readonly kind: "message"; readonly key: string; readonly message: MessagePayload };

const QUICK_REACTIONS = ["👍", "🎉", "👀", "❤️"] as const;

/** Flat, realtime, decrypted message list with day separators. */
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
  firstUnreadId,
  onReply,
  onJumpToFirstUnread,
}: MessageListProps) {
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

  return (
    <FlatList
      className="flex-1"
      data={rows}
      keyExtractor={(row) => row.key}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}
      ListHeaderComponent={
        firstUnreadId !== null ? (
          <Pressable
            onPress={onJumpToFirstUnread}
            className="mb-2 self-start rounded-pill bg-accent-soft px-3 py-1"
          >
            <Text size="xs" tone="accent">
              Jump to first unread
            </Text>
          </Pressable>
        ) : null
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
            attachments={attachments.get(item.message.id) ?? []}
            pending={pendingIds.has(item.message.id)}
            ownUserId={ownUserId}
            authorName={memberNames.get(item.message.authorId) ?? item.message.authorId}
            authorColor={memberColors.get(item.message.authorId)}
            onReply={onReply}
          />
        )
      }
    />
  );
}

function MessageRow({
  runtime,
  channelId,
  message,
  text,
  attachments,
  pending,
  ownUserId,
  authorName,
  authorColor,
  onReply,
}: {
  runtime: MobileChatRuntime | undefined;
  channelId: string;
  message: MessagePayload;
  text: string | undefined;
  attachments: readonly AttachmentDescriptor[];
  pending: boolean;
  ownUserId: string;
  authorName: string;
  authorColor: string | undefined;
  onReply(message: MessagePayload): void;
}) {
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
      <NativeAvatar
        seed={userAvatarSeed(message.authorId)}
        size={32}
        {...(authorColor !== undefined ? { roleColor: authorColor } : {})}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-baseline gap-2">
          <Text
            size="sm"
            className="font-medium"
            style={authorColor !== undefined ? { color: authorColor } : undefined}
          >
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
        <Text size="sm" className="text-text">
          {text ?? (pending ? "" : "Unable to decrypt this message.")}
        </Text>
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
            onReply={() => onReply(message)}
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
}: {
  runtime: MobileChatRuntime;
  channelId: string;
  messageId: string;
  ownUserId: string;
  onReply: () => void;
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
    void runtime.session.toggleReaction(channelId, messageId, emoji);
  }

  return (
    <View className="mt-0.5 flex-row flex-wrap gap-1">
      {groups.map((group) => (
        <Pressable
          key={group.emoji}
          accessibilityLabel={`${group.emoji} ${group.count}`}
          accessibilityState={{ selected: group.mine }}
          className={
            group.mine
              ? "rounded-pill border border-accent bg-accent-soft px-2 py-0.5"
              : "rounded-pill border border-border bg-surface-3 px-2 py-0.5"
          }
          onPress={() => toggle(group.emoji)}
        >
          <Text size="xs">
            {group.emoji} {group.count}
          </Text>
        </Pressable>
      ))}
      {groups.length === 0 &&
        QUICK_REACTIONS.slice(0, 3).map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityLabel={`React ${emoji}`}
            className="rounded-pill border border-border bg-surface-3 px-2 py-0.5"
            onPress={() => toggle(emoji)}
          >
            <Text size="xs">{emoji}</Text>
          </Pressable>
        ))}
      <Pressable accessibilityLabel="Reply in thread" className="px-2 py-0.5" onPress={onReply}>
        <Text size="xs" tone="muted">
          Reply
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
