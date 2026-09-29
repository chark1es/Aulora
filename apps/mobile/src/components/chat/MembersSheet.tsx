import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import type { PresenceRow } from "@aulora/core";
import { Button, Heading, Icon, presenceColor, Text, usePalette } from "@aulora/ui-native";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { presenceLabel } from "../../lib/presence";
import { StatusEditor } from "./StatusEditor";

type PresenceStatus = PresenceRow["status"];

export interface MembersSheetProps {
  readonly visible: boolean;
  readonly presence: readonly PresenceRow[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly ownerUserId?: string | null;
  readonly canModerateMembers?: boolean;
  readonly onClose: () => void;
  readonly onSetStatus: (status: PresenceRow["status"], customStatus?: string) => void;
  /** Opens the voice/video device settings; omitted hides the entry. */
  readonly onOpenVoiceSettings?: () => void;
  /** Opens moderation actions for a member; omitted hides the action. */
  readonly onMemberActions?: (userId: string) => void;
  /** Opens the general settings surface; omitted hides the entry. */
  readonly onOpenSettings?: () => void;
  /** Opens the workspace ban list; omitted hides the entry. */
  readonly onOpenBans?: () => void;
}

/** Bottom sheet with presence, a status switcher and member moderation. */
export function MembersSheet({
  visible,
  presence,
  memberNames,
  ownUserId,
  ownerUserId = null,
  canModerateMembers = false,
  onClose,
  onSetStatus,
  onOpenVoiceSettings,
  onMemberActions,
  onOpenSettings,
  onOpenBans,
}: MembersSheetProps) {
  const ownPresence = presence.find((row) => row.userId === ownUserId);
  const ownStatus: PresenceStatus = ownPresence?.status ?? "offline";
  const ownCustomStatus = ownPresence?.customStatus ?? "";
  const palette = usePalette();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}} className="max-h-[70%] rounded-t-card bg-surface-1 p-4">
          <View className="flex-row items-center justify-between">
            <Heading level={3}>Members</Heading>
            <View className="flex-row gap-2">
              {onOpenBans !== undefined && (
                <Button size="sm" variant="secondary" onPress={onOpenBans}>
                  Banned
                </Button>
              )}
              {onOpenSettings !== undefined && (
                <Button size="sm" variant="secondary" onPress={onOpenSettings}>
                  Settings
                </Button>
              )}
              {onOpenVoiceSettings !== undefined && (
                <Button size="sm" variant="secondary" onPress={onOpenVoiceSettings}>
                  Voice &amp; video
                </Button>
              )}
            </View>
          </View>
          <View className="mt-3">
            <StatusEditor
              status={ownStatus}
              customStatus={ownCustomStatus}
              onSetStatus={onSetStatus}
            />
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
            {presence.map((row) => {
              const canAct =
                canModerateMembers &&
                onMemberActions !== undefined &&
                row.userId !== ownUserId &&
                row.userId !== ownerUserId;
              return (
                <View key={row.userId} className="flex-row items-center gap-3">
                  <NativeAvatar seed={userAvatarSeed(row.userId)} size={32} />
                  <View className="flex-1">
                    <Text size="sm">
                      {memberNames.get(row.userId) ?? row.userId}
                      {row.userId === ownUserId ? " (you)" : ""}
                    </Text>
                    {row.customStatus !== null && row.customStatus.length > 0 && (
                      <Text size="xs" tone="muted">
                        {row.customStatus}
                      </Text>
                    )}
                    <Text size="xs" tone="muted">
                      {presenceLabel(row.status)}
                    </Text>
                  </View>
                  {canAct && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Actions for ${
                        memberNames.get(row.userId) ?? row.userId
                      }`}
                      className="rounded-input px-2 py-1"
                      onPress={() => onMemberActions?.(row.userId)}
                    >
                      <Icon name="more-horizontal" size={18} color={palette["text-muted"]} />
                    </Pressable>
                  )}
                  <View
                    className="h-2.5 w-2.5 rounded-pill"
                    style={{ backgroundColor: presenceColor(row.status, palette) }}
                  />
                </View>
              );
            })}
            {presence.length === 0 && (
              <Text size="sm" tone="muted">
                No presence data yet.
              </Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
