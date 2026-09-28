import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import { activityLabel } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-native";
import { Pressable, ScrollView, View } from "react-native";

/** One row of the Threads inbox, as returned by `api.messages.threadInbox`. */
export interface ThreadInboxItem {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: number;
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  readonly participantIds: readonly string[];
  readonly mentionedUserIds: readonly string[];
  readonly viewerParticipated: boolean;
  readonly viewerMentioned: boolean;
}

export interface ThreadsInboxProps {
  readonly threads: readonly ThreadInboxItem[];
  readonly loading?: boolean;
  readonly channelNames: ReadonlyMap<string, string>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors?: ReadonlyMap<string, string>;
  /** Display title per channel id, used for DMs (named after their members). */
  readonly titles?: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly onOpen: (thread: ThreadInboxItem) => void;
}

function replyLabel(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}

/**
 * The mobile "Threads" view: every thread the viewer replied to or was
 * mentioned in, most recently active first. Selecting a row opens the thread
 * sheet over the chat.
 */
export function ThreadsInbox({
  threads,
  loading = false,
  channelNames,
  memberNames,
  memberColors,
  titles,
  ownUserId,
  onOpen,
}: ThreadsInboxProps) {
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center gap-3">
        <Spinner size={26} label="Loading threads" />
        <Text size="sm" tone="muted">
          Loading threads…
        </Text>
      </View>
    );
  }

  if (threads.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <View className="h-12 w-12 items-center justify-center rounded-card bg-accent-soft">
          <Text size="lg" tone="accent">
            #
          </Text>
        </View>
        <Text size="lg" className="font-semibold">
          No threads yet
        </Text>
        <Text size="sm" tone="muted" className="text-center">
          Threads you reply to or get mentioned in will show up here.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 8, gap: 2 }}>
      {threads.map((thread) => {
        const channelName = channelNames.get(thread.channelId);
        const channelLabel =
          channelName !== undefined
            ? `#${channelName}`
            : (titles?.get(thread.channelId) ?? "Direct message");
        const authorName =
          thread.authorId === ownUserId
            ? "You"
            : (memberNames.get(thread.authorId) ?? "Unknown member");
        const roleColor = memberColors?.get(thread.authorId);
        const lastActivity = thread.lastReplyAt ?? thread.createdAt;
        return (
          <Pressable
            key={thread.id}
            accessibilityRole="button"
            onPress={() => onOpen(thread)}
            className="flex-row items-start gap-3 rounded-input px-2.5 py-2"
          >
            <NativeAvatar
              seed={userAvatarSeed(thread.authorId)}
              size={32}
              {...(roleColor !== undefined && roleColor.length > 0 ? { roleColor } : {})}
            />
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-baseline gap-2">
                <Text size="xs" className="font-semibold" numberOfLines={1}>
                  {authorName}
                </Text>
                <Text size="xs" tone="muted" numberOfLines={1} className="flex-1">
                  {channelLabel}
                </Text>
                {thread.viewerMentioned && (
                  <Text size="xs" tone="accent" className="rounded-pill bg-accent-soft px-2 py-0.5">
                    Mentioned you
                  </Text>
                )}
                <Text size="xs" tone="muted">
                  {activityLabel(lastActivity)}
                </Text>
              </View>
              <Text size="sm" numberOfLines={2}>
                {thread.body}
              </Text>
              <Text size="xs" tone="muted">
                {replyLabel(thread.replyCount)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
