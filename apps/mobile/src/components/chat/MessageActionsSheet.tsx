import { hasPermission, type MessagePayload, messageTime, Permission } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { selectionFeedback } from "../../lib/haptics";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const;

export function MessageActionsSheet({
  visible,
  runtime,
  message,
  text,
  authorName,
  ownUserId,
  permissions,
  onReply,
  onQuote,
  onClose,
}: {
  readonly visible: boolean;
  readonly runtime: ChatSurfaceRuntime;
  readonly message: MessagePayload;
  readonly text: string;
  readonly authorName: string;
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly onReply?: (() => void) | undefined;
  readonly onQuote?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const [mode, setMode] = useState<"actions" | "edit" | "emoji">("actions");
  const [emoji, setEmoji] = useState("");
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit =
    message.authorId === ownUserId || hasPermission(permissions, Permission.ManageMessages);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the sheet opens on a message
  useEffect(() => {
    if (visible) {
      setMode("actions");
      setEmoji("");
      setDraft(text);
      setError(null);
    }
  }, [visible, message.id]);

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
  function react(value: string) {
    selectionFeedback();
    run(() => runtime.session.toggleReaction(message.channelId, message.id, value));
  }

  const inputStyle = {
    color: palette.text,
    backgroundColor: palette["surface-2"],
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
  } as const;

  return (
    <BottomSheet
      visible={visible}
      title={mode === "edit" ? "Edit message" : mode === "emoji" ? "React" : authorName}
      subtitle={mode === "actions" ? messageTime(message.createdAt) : undefined}
      onClose={onClose}
    >
      {mode === "edit" ? (
        <View className="gap-3">
          <BottomSheetTextInput
            accessibilityLabel="Message"
            multiline
            autoFocus
            value={draft}
            onChangeText={setDraft}
            placeholderTextColor={palette["text-muted"]}
            style={[inputStyle, { minHeight: 96, maxHeight: 200, textAlignVertical: "top" }]}
          />
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setMode("actions")}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={busy}
              disabled={draft.trim().length === 0 || draft === text}
              onPress={() =>
                run(() => runtime.session.editMessage(message.channelId, message.id, draft))
              }
            >
              Save
            </Button>
          </View>
        </View>
      ) : mode === "emoji" ? (
        <View className="gap-3">
          <BottomSheetTextInput
            accessibilityLabel="Emoji"
            autoFocus
            placeholder="Type or paste an emoji"
            placeholderTextColor={palette["text-muted"]}
            value={emoji}
            onChangeText={setEmoji}
            maxLength={16}
            style={inputStyle}
          />
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setMode("actions")}>
              Back
            </Button>
            <Button
              className="flex-1"
              loading={busy}
              disabled={emoji.trim().length === 0}
              onPress={() => react(emoji.trim())}
            >
              Add reaction
            </Button>
          </View>
        </View>
      ) : (
        <>
          {text.length > 0 && (
            <Text size="sm" tone="muted" numberOfLines={3} className="px-1">
              {text}
            </Text>
          )}
          {hasPermission(permissions, Permission.AddReactions) && (
            <View className="flex-row justify-between">
              {QUICK_REACTIONS.map((reaction) => (
                <Pressable
                  key={reaction}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${reaction}`}
                  disabled={busy}
                  onPress={() => react(reaction)}
                  className="h-12 w-12 items-center justify-center rounded-pill bg-surface-2 active:bg-surface-3"
                >
                  <Text style={{ fontSize: 22, lineHeight: 28 }} maxFontSizeMultiplier={1.3}>
                    {reaction}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="React with another emoji"
                disabled={busy}
                onPress={() => setMode("emoji")}
                className="h-12 w-12 items-center justify-center rounded-pill bg-surface-2 active:bg-surface-3"
              >
                <Icon name="plus" size={20} color={palette["text-muted"]} />
              </Pressable>
            </View>
          )}
          <ListGroup>
            {onQuote !== undefined && (
              <ListRow
                icon="reply"
                title="Reply"
                onPress={() => {
                  onClose();
                  onQuote();
                }}
              />
            )}
            {onReply !== undefined && (
              <ListRow
                icon="thread"
                title="Reply in thread"
                onPress={() => {
                  onClose();
                  onReply();
                }}
              />
            )}
            <ListRow
              icon="file"
              title="Copy text"
              onPress={() => run(() => Clipboard.setStringAsync(text))}
            />
            {hasPermission(permissions, Permission.PinMessages) && (
              <ListRow
                icon="pin"
                title={message.pinnedAt === null ? "Pin to conversation" : "Unpin"}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    message.pinnedAt === null
                      ? runtime.session.pinMessage(message.channelId, message.id)
                      : runtime.session.unpinMessage(message.channelId, message.id),
                  )
                }
              />
            )}
            {canEdit && <ListRow icon="pencil" title="Edit" onPress={() => setMode("edit")} />}
          </ListGroup>
          {canEdit && (
            <ListGroup>
              <ListRow
                icon="trash"
                title="Delete message"
                tone="danger"
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
              />
            </ListGroup>
          )}
        </>
      )}
      {error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
    </BottomSheet>
  );
}
