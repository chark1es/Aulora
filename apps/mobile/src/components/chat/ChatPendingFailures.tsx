import { Button, Text } from "@aulora/ui-native";
import { Alert, View } from "react-native";
import { useActionError } from "../../lib/use-action-error";
import type { ChatScreenModel } from "./use-chat-screen-model";

type PendingItem = ChatScreenModel["pendingItems"][number];

export function ChatPendingFailures({ model }: { readonly model: ChatScreenModel }) {
  const failed = model.pendingItems.filter((item) => item.status === "failed");
  if (failed.length === 0) {
    return null;
  }
  return failed.map((item) => renderPendingFailure(model, item));
}

function renderPendingFailure(model: ChatScreenModel, item: PendingItem) {
  return <ChatPendingFailure key={item.id} model={model} item={item} />;
}

function ChatPendingFailure({
  model,
  item,
}: {
  readonly model: ChatScreenModel;
  readonly item: PendingItem;
}) {
  const actionError = useActionError(model.ownUserId);
  const preview = item.text.trim() || `Attachment only · ${item.attachments?.length ?? 0} files`;
  return (
    <View className="mx-3 mb-1.5 flex-row items-center gap-1 rounded-card bg-surface-2 py-1 pl-3 pr-1">
      <View className="flex-1 min-w-0">
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {item.failureReason ?? "Message couldn’t be sent."}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <Button
        size="sm"
        variant="ghost"
        accessibilityLabel={`Retry sending: ${preview.slice(0, 30)}`}
        onPress={() => {
          void model.retrySend(item.id).catch((cause: unknown) => {
            actionError.show("Couldn’t retry message", cause);
          });
        }}
      >
        Retry
      </Button>
      <Button
        size="sm"
        variant="ghost"
        accessibilityLabel={`Discard unsent message: ${preview.slice(0, 30)}`}
        onPress={() => {
          Alert.alert(
            "Discard failed message?",
            "This message was not sent. Discarding removes it from this conversation.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Discard message",
                style: "destructive",
                onPress: () => {
                  void model.discardSend(item.id).catch((cause: unknown) => {
                    actionError.show("Couldn’t discard message", cause);
                  });
                },
              },
            ],
          );
        }}
      >
        Discard
      </Button>
    </View>
  );
}
