import { Button, Spinner, Text } from "@aulora/ui-native";
import { usePaginatedQuery } from "convex/react";
import { ScrollView } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { Sheet } from "./Sheet";

export function PinnedMessagesSheet({
  channelId,
  memberNames,
  onOpen,
  onClose,
}: {
  readonly channelId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onOpen: (messageId: string) => void;
  readonly onClose: () => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listPins,
    { channelId: channelId as never },
    { initialNumItems: 30 },
  );
  return (
    <Sheet visible title="Pinned messages" onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {status === "LoadingFirstPage" && <Spinner label="Loading pinned messages" />}
        {results
          .filter((message) => message.deletedAt === null)
          .map((message) => (
            <Button
              key={message.id}
              variant="secondary"
              onPress={() => {
                onClose();
                onOpen(message.id);
              }}
            >
              <Text>
                {memberNames.get(message.authorId) ?? "Member"}
                {"\n"}
                {message.body}
              </Text>
            </Button>
          ))}
        {status !== "LoadingFirstPage" &&
          results.filter((message) => message.deletedAt === null).length === 0 && (
            <Text tone="muted">No pinned messages in this conversation.</Text>
          )}
        {status === "CanLoadMore" && (
          <Button variant="ghost" onPress={() => loadMore(30)}>
            Load more
          </Button>
        )}
        {status === "LoadingMore" && <Spinner label="Loading more pinned messages" />}
      </ScrollView>
    </Sheet>
  );
}
