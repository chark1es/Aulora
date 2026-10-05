import { Button, Text } from "@aulora/ui-native";
import { Alert, View } from "react-native";
import { errorMessage } from "./chat-screen-types";
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
  return (
    <View className="mx-3 mb-1.5 flex-row items-center gap-1 rounded-card bg-surface-2 py-1 pl-3 pr-1">
      <Text size="sm" tone="danger" accessibilityRole="alert" className="flex-1">
        Message couldn't be sent.
      </Text>
      <Button
        size="sm"
        variant="ghost"
        onPress={() =>
          void model.retrySend(item.id).catch((cause: unknown) => {
            Alert.alert("Couldn't retry message", errorMessage(cause));
          })
        }
      >
        Retry
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onPress={() =>
          void model.discardSend(item.id).catch((cause: unknown) => {
            Alert.alert("Couldn't discard message", errorMessage(cause));
          })
        }
      >
        Discard
      </Button>
    </View>
  );
}
