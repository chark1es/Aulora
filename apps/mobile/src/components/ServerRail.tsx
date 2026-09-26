import { NativeAvatar } from "@aulora/avatars/native";
import { IconButton, Logo, Text } from "@aulora/ui-native";
import { Pressable, ScrollView, View } from "react-native";
import { useProfiles } from "../providers/ProfileProvider";

/** Discord-style server rail: the Aulora mark, saved servers and add. */
export function ServerRail({ onAddServer }: { readonly onAddServer: () => void }) {
  const { profiles, activeProfile, setActive } = useProfiles();

  return (
    <View className="h-full w-16 items-center gap-3 border-r border-border bg-surface-1 py-4">
      <Logo size={28} title="Aulora" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ alignItems: "center", gap: 10 }}
        showsVerticalScrollIndicator={false}
      >
        {profiles.map((profile) => {
          const active = activeProfile?.id === profile.id;
          return (
            <Pressable
              key={profile.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${profile.name}`}
              onPress={() => {
                void setActive(profile.id);
              }}
              className={active ? "rounded-pill bg-surface-3" : ""}
            >
              <NativeAvatar seed={profile.iconSeed} size={36} title={profile.name} />
            </Pressable>
          );
        })}
      </ScrollView>
      <IconButton label="Add a server" variant="secondary" onPress={onAddServer}>
        <Text size="lg">+</Text>
      </IconButton>
    </View>
  );
}
