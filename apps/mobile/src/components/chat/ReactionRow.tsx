import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { selectionFeedback } from "../../lib/haptics";
import { groupReactions, type ReactionGroup } from "../../lib/message-rows";

interface ReactionChipProps {
  readonly group: ReactionGroup;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function ReactionChip({ group, disabled, onPress }: ReactionChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityLabel={`${group.emoji} ${group.count}`}
      accessibilityState={{ selected: group.mine }}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      className={`h-8 flex-row items-center gap-1 rounded-pill border px-2.5 active:opacity-70 ${
        group.mine ? "border-accent bg-accent-soft" : "border-transparent bg-surface-2"
      }`}
      onPress={onPress}
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
  );
}

export interface ReactionRowProps {
  readonly runtime: ChatSurfaceRuntime;
  readonly channelId: string;
  readonly messageId: string;
  readonly ownUserId: string;
  /** Opens the message's actions, where any emoji can be chosen. */
  readonly onAdd: () => void;
  readonly pending: boolean;
  readonly canReact: boolean;
}

/** The reactions on one message, kept live; hidden until there is at least one. */
export function ReactionRow(props: ReactionRowProps) {
  const { runtime, channelId, messageId, ownUserId, pending, canReact } = props;
  const palette = usePalette();
  const [groups, setGroups] = useState<readonly ReactionGroup[]>([]);

  useEffect(() => {
    const off = runtime.subscriptions.watchReactions(messageId, (rows) => {
      void runtime.session.loadReactions(channelId, messageId, rows).then((resolved) => {
        setGroups(groupReactions(resolved, ownUserId));
      });
    });
    return () => {
      off();
    };
  }, [runtime, channelId, messageId, ownUserId]);

  function toggle(emoji: string) {
    selectionFeedback();
    void runtime.session.toggleReaction(channelId, messageId, emoji).catch(() => {
      Alert.alert("Couldn't update reaction", "Try again when you are connected.");
    });
  }

  if (groups.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5 pt-0.5">
      {groups.map((group) => (
        <ReactionChip
          key={group.emoji}
          group={group}
          disabled={pending || !canReact}
          onPress={() => {
            toggle(group.emoji);
          }}
        />
      ))}
      {canReact && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add reaction"
          disabled={pending}
          hitSlop={8}
          className="h-8 w-9 items-center justify-center rounded-pill bg-surface-2 active:opacity-70"
          onPress={props.onAdd}
        >
          <Icon name="smile" size={16} color={palette["text-muted"]} />
        </Pressable>
      )}
    </View>
  );
}
