import { NativeAvatar } from "@aulora/avatars/native";
import { Icon, usePalette } from "@aulora/ui-native";
import { useRouter } from "expo-router";
import { useProfiles } from "../../providers/ProfileProvider";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";

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
    <BottomSheet
      visible={visible}
      title="Workspaces"
      subtitle={profiles.length === 0 ? "No workspaces yet" : undefined}
      onClose={onClose}
    >
      {profiles.length > 0 && (
        <ListGroup>
          {profiles.map((profile) => {
            const active = activeProfile?.id === profile.id;
            return (
              <ListRow
                key={profile.id}
                accessibilityLabel={`Switch to ${profile.name}`}
                title={profile.name}
                subtitle={profileHost(profile.baseUrl)}
                selected={active}
                leading={<NativeAvatar seed={profile.iconSeed} size={36} shape="squircle" />}
                trailing={
                  active ? <Icon name="check" size={18} color={palette.accent} /> : undefined
                }
                onPress={() => {
                  onClose();
                  if (!active) void setActive(profile.id);
                }}
              />
            );
          })}
        </ListGroup>
      )}
      <ListGroup>
        <ListRow
          icon="plus"
          title="Add a workspace"
          subtitle="Connect to another Aulora server"
          onPress={() => {
            onClose();
            router.push("/connect");
          }}
        />
      </ListGroup>
    </BottomSheet>
  );
}
