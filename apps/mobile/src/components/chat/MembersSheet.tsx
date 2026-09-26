import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import type { PresenceRow } from "@aulora/core";
import { Heading, presenceColor, Text } from "@aulora/ui-native";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { presenceLabel } from "../../lib/presence";

export interface MembersSheetProps {
  readonly visible: boolean;
  readonly presence: readonly PresenceRow[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onClose: () => void;
  readonly onSetStatus: (status: "online" | "idle" | "dnd") => void;
}

/** Bottom sheet with presence and a status switcher. */
export function MembersSheet({
  visible,
  presence,
  memberNames,
  onClose,
  onSetStatus,
}: MembersSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <View className="max-h-[70%] rounded-t-card bg-surface-1 p-4">
          <Heading level={3}>Members</Heading>
          <View className="mt-2 flex-row gap-2">
            {(["online", "idle", "dnd"] as const).map((status) => (
              <Pressable
                key={status}
                className="rounded-pill border border-border bg-surface-3 px-3 py-1"
                onPress={() => onSetStatus(status)}
              >
                <Text size="xs">{presenceLabel(status)}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
            {presence.map((row) => (
              <View key={row.userId} className="flex-row items-center gap-3">
                <NativeAvatar seed={userAvatarSeed(row.userId)} size={32} />
                <View className="flex-1">
                  <Text size="sm">{memberNames.get(row.userId) ?? row.userId}</Text>
                  <Text size="xs" tone="muted">
                    {presenceLabel(row.status)}
                  </Text>
                </View>
                <View
                  className="h-2.5 w-2.5 rounded-pill"
                  style={{ backgroundColor: presenceColor(row.status) }}
                />
              </View>
            ))}
            {presence.length === 0 && (
              <Text size="sm" tone="muted">
                No presence data yet.
              </Text>
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}
