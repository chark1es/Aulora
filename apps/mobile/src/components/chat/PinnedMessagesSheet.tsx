import { activityLabel } from "@aulora/core";
import { Button, Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import { usePaginatedQuery } from "convex/react";
import { Pressable, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { BottomSheet } from "./BottomSheet";
import { ListGroup } from "./List";
import { MemberAvatar } from "./MemberAvatar";

export function PinnedMessagesSheet({
  visible,
  channelId,
  memberNames,
  onOpen,
  onClose,
}: {
  readonly visible: boolean;
  readonly channelId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onOpen: (messageId: string) => void;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listPins,
    visible ? { channelId: channelId as never } : "skip",
    { initialNumItems: 30 },
  );
  const pins = results.filter((message) => message.deletedAt === null);
  return (
    <BottomSheet visible={visible} title="Pinned messages" onClose={onClose}>
      {status === "LoadingFirstPage" ? (
        <View className="items-center py-6">
          <Spinner label="Loading pinned messages" />
        </View>
      ) : pins.length === 0 ? (
        <View className="items-center gap-2 px-6 py-8">
          <Icon name="pin" size={26} color={palette["text-muted"]} />
          <Text tone="muted" className="text-center">
            Nothing pinned yet. Long-press a message to pin it here.
          </Text>
        </View>
      ) : (
        <ListGroup inset={56}>
          {pins.map((message) => (
            <Pressable
              key={message.id}
              accessibilityRole="button"
              android_ripple={{ color: palette["surface-3"] }}
              className="flex-row gap-3 px-3 py-2.5 active:bg-surface-3"
              onPress={() => {
                onClose();
                onOpen(message.id);
              }}
            >
              <MemberAvatar userId={message.authorId} size={32} />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-baseline gap-2">
                  <Text size="sm" className="shrink font-semibold" numberOfLines={1}>
                    {memberNames.get(message.authorId) ?? "Member"}
                  </Text>
                  <Text size="xs" tone="muted">
                    {activityLabel(message.createdAt)}
                  </Text>
                </View>
                <Text size="sm" tone="muted" numberOfLines={3}>
                  {message.body}
                </Text>
              </View>
            </Pressable>
          ))}
        </ListGroup>
      )}
      {status === "CanLoadMore" && (
        <Button variant="ghost" onPress={() => loadMore(30)}>
          Load more
        </Button>
      )}
      {status === "LoadingMore" && <Spinner label="Loading more pinned messages" />}
    </BottomSheet>
  );
}
