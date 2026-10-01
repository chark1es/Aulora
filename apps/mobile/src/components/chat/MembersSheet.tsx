import type { PresenceRow } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, ScrollView, View } from "react-native";
import { presenceLabel } from "../../lib/presence";
import { MemberAvatar } from "./MemberAvatar";
import { Sheet } from "./Sheet";

export interface MembersSheetProps {
  readonly visible: boolean;
  readonly presence: readonly PresenceRow[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly ownerUserId?: string | null;
  readonly canModerateMembers?: boolean;
  readonly onClose: () => void;
  readonly onSetStatus: (status: PresenceRow["status"], customStatus?: string) => void;
  readonly onOpenVoiceSettings?: () => void;
  readonly onMemberActions?: (userId: string) => void;
  readonly onMemberPress?: (userId: string) => void;
  readonly onOpenSettings?: () => void;
  readonly onOpenBans?: () => void;
}

/** All workspace members, including people with no current presence row. */
export function MembersSheet({
  visible,
  presence,
  memberNames,
  ownUserId,
  ownerUserId = null,
  canModerateMembers = false,
  onClose,
  onOpenVoiceSettings,
  onMemberActions,
  onMemberPress,
  onOpenSettings,
  onOpenBans,
}: MembersSheetProps) {
  const palette = usePalette();
  return (
    <Sheet visible={visible} title="Members" onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View className="flex-row flex-wrap gap-2">
          {onOpenBans !== undefined && (
            <Button variant="secondary" onPress={onOpenBans}>
              Banned
            </Button>
          )}
          {onOpenSettings !== undefined && (
            <Button variant="secondary" onPress={onOpenSettings}>
              Settings
            </Button>
          )}
          {onOpenVoiceSettings !== undefined && (
            <Button variant="secondary" onPress={onOpenVoiceSettings}>
              Voice &amp; video
            </Button>
          )}
        </View>
        {[...memberNames].map(([userId, name]) => {
          const row = presence.find((entry) => entry.userId === userId);
          const canAct =
            canModerateMembers &&
            onMemberActions !== undefined &&
            userId !== ownUserId &&
            userId !== ownerUserId;
          return (
            <View key={userId} className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Profile of ${name}`}
                disabled={onMemberPress === undefined}
                className="min-h-12 flex-1 flex-row items-center gap-3 rounded-input bg-surface-2 p-3"
                onPress={() => onMemberPress?.(userId)}
              >
                <MemberAvatar userId={userId} size={36} />
                <View className="min-w-0 flex-1 gap-1">
                  <Text>
                    {name}
                    {userId === ownUserId ? " (you)" : ""}
                  </Text>
                  <Text size="sm" tone="muted">
                    {presenceLabel(row?.status ?? "offline")}
                  </Text>
                  {row?.customStatus && (
                    <Text size="sm" tone="muted">
                      {row.customStatus}
                    </Text>
                  )}
                </View>
              </Pressable>
              {canAct && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Actions for ${name}`}
                  className="h-12 w-12 items-center justify-center"
                  onPress={() => onMemberActions?.(userId)}
                >
                  <Icon name="more-horizontal" size={20} color={palette.text} />
                </Pressable>
              )}
            </View>
          );
        })}
        {memberNames.size === 0 && <Text tone="muted">No members yet.</Text>}
      </ScrollView>
    </Sheet>
  );
}
