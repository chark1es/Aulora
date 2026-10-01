import { NativeAvatar } from "@aulora/avatars/native";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { useRouter } from "expo-router";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useProfiles } from "../../providers/ProfileProvider";

/** The host (with port) of a profile's base URL, for the quiet workspace caption. */
function profileHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export interface WorkspaceSwitcherSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

/** Bottom sheet that switches between saved workspaces and adds a new one. */
export function WorkspaceSwitcherSheet({ visible, onClose }: WorkspaceSwitcherSheetProps) {
  const { profiles, activeProfile, setActive } = useProfiles();
  const router = useRouter();
  const palette = usePalette();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}} className="max-h-[70%] rounded-t-card bg-surface-1 p-4">
          <Heading level={3}>Workspaces</Heading>
          <ScrollView contentContainerStyle={{ gap: 4, paddingVertical: 12 }}>
            {profiles.map((profile) => {
              const active = activeProfile?.id === profile.id;
              return (
                <Pressable
                  key={profile.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${profile.name}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    void setActive(profile.id);
                    onClose();
                  }}
                  className={
                    active
                      ? "flex-row items-center gap-3 rounded-input bg-surface-3 px-3 py-2"
                      : "flex-row items-center gap-3 rounded-input px-3 py-2"
                  }
                >
                  <NativeAvatar seed={profile.iconSeed} size={36} title={profile.name} />
                  <View className="flex-1">
                    <Text size="sm">{profile.name}</Text>
                    <Text size="xs" tone="muted" mono numberOfLines={1} ellipsizeMode="tail">
                      {profileHost(profile.baseUrl)}
                    </Text>
                  </View>
                  {active && (
                    <View accessibilityLabel="Current workspace">
                      <Icon name="check" size={18} color={palette.accent} />
                    </View>
                  )}
                </Pressable>
              );
            })}
            {profiles.length === 0 && (
              <Text size="sm" tone="muted">
                No workspaces yet.
              </Text>
            )}
          </ScrollView>
          <View className="border-t border-border pt-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a workspace"
              className="rounded-input px-3 py-3"
              onPress={() => {
                onClose();
                router.push("/connect");
              }}
            >
              <Text>Add a workspace</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              className="rounded-input px-3 py-3"
              onPress={onClose}
            >
              <Text tone="muted">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
