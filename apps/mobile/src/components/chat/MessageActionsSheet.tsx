import { hasPermission, type MessagePayload, Permission } from "@aulora/core";
import { Button, Input, Text } from "@aulora/ui-native";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { Sheet } from "./Sheet";

export function MessageActionsSheet({
  runtime,
  message,
  text,
  ownUserId,
  permissions,
  onReply,
  onQuote,
  onClose,
}: {
  readonly runtime: ChatSurfaceRuntime;
  readonly message: MessagePayload;
  readonly text: string;
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly onReply?: (() => void) | undefined;
  readonly onQuote?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const [emoji, setEmoji] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit =
    message.authorId === ownUserId || hasPermission(permissions, Permission.ManageMessages);
  function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    void task()
      .then(onClose)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Couldn't update this message. Try again.",
        ),
      )
      .finally(() => setBusy(false));
  }
  return (
    <Sheet visible title={editing ? "Edit message" : "Message"} onClose={onClose}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        {editing ? (
          <>
            <Input label="Message" multiline value={draft} onChangeText={setDraft} />
            <Button
              loading={busy}
              disabled={draft.trim().length === 0}
              onPress={() =>
                run(() => runtime.session.editMessage(message.channelId, message.id, draft))
              }
            >
              Save changes
            </Button>
            <Button variant="ghost" onPress={() => setEditing(false)}>
              Cancel editing
            </Button>
          </>
        ) : (
          <>
            <Text>{text}</Text>
            {hasPermission(permissions, Permission.AddReactions) && (
              <>
                <View className="flex-row flex-wrap gap-2">
                  {["👍", "🎉", "👀", "❤️", "😂", "✅"].map((reaction) => (
                    <Button
                      key={reaction}
                      variant="secondary"
                      accessibilityLabel={`React ${reaction}`}
                      disabled={busy}
                      onPress={() =>
                        run(() =>
                          runtime.session.toggleReaction(message.channelId, message.id, reaction),
                        )
                      }
                    >
                      {reaction}
                    </Button>
                  ))}
                </View>
                <Input
                  label="Another reaction"
                  placeholder="Type or paste an emoji"
                  value={emoji}
                  onChangeText={setEmoji}
                  maxLength={16}
                />
                <Button
                  variant="secondary"
                  disabled={busy || emoji.trim().length === 0}
                  onPress={() =>
                    run(() =>
                      runtime.session.toggleReaction(message.channelId, message.id, emoji.trim()),
                    )
                  }
                >
                  Add reaction
                </Button>
              </>
            )}
            {onReply !== undefined && (
              <Button
                variant="secondary"
                onPress={() => {
                  onClose();
                  onReply?.();
                }}
              >
                Reply in thread
              </Button>
            )}
            {onQuote !== undefined && (
              <Button
                variant="secondary"
                onPress={() => {
                  onClose();
                  onQuote();
                }}
              >
                Reply in conversation
              </Button>
            )}
            <Button variant="secondary" onPress={() => run(() => Clipboard.setStringAsync(text))}>
              Copy text
            </Button>
            {hasPermission(permissions, Permission.PinMessages) && (
              <Button
                variant="secondary"
                loading={busy}
                onPress={() =>
                  run(() =>
                    message.pinnedAt === null
                      ? runtime.session.pinMessage(message.channelId, message.id)
                      : runtime.session.unpinMessage(message.channelId, message.id),
                  )
                }
              >
                {message.pinnedAt === null ? "Pin message" : "Unpin message"}
              </Button>
            )}
            {canEdit && (
              <>
                <Button variant="secondary" disabled={busy} onPress={() => setEditing(true)}>
                  Edit message
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Delete message?",
                      "This message will be removed for everyone in the conversation.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete message",
                          style: "destructive",
                          onPress: () =>
                            run(() => runtime.session.deleteMessage(message.channelId, message.id)),
                        },
                      ],
                    )
                  }
                >
                  Delete message
                </Button>
              </>
            )}
          </>
        )}
        {error !== null && (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
