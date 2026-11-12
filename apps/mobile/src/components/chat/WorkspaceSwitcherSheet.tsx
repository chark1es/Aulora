import { NativeAvatar } from "@aulora/avatars/native";
import { CountBadge, Icon, usePalette } from "@aulora/ui-native";
import { useRouter } from "expo-router";
import { useWorkspaceUnreadCounts } from "../../lib/use-workspace-notifications";
import { clearWorkspaceUnread } from "../../lib/workspace-notifications";
import { useProfiles } from "../../providers/ProfileProvider";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";

/** The host (with port) of a profile’s base URL, for the quiet workspace caption. */
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
  const unreadByWorkspace = useWorkspaceUnreadCounts();
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
            const unread = unreadByWorkspace.get(profile.id) ?? 0;
            return (
              <ListRow
                key={profile.id}
                accessibilityLabel={
                  unread > 0
                    ? `Switch to ${profile.name}, ${unread} new notification${unread === 1 ? "" : "s"}`
                    : `Switch to ${profile.name}`
                }
                title={profile.name}
                subtitle={profileHost(profile.baseUrl)}
                selected={active}
                leading={<NativeAvatar seed={profile.iconSeed} size={36} shape="squircle" />}
                trailing={
                  active ? (
                    <Icon name="check" size={18} color={palette.accent} />
                  ) : unread > 0 ? (
                    <CountBadge
                      count={unread}
                      label={`${unread} new notification${unread === 1 ? "" : "s"}`}
                    />
                  ) : undefined
                }
                onPress={() => {
                  onClose();
                  clearWorkspaceUnread(profile.id);
                  if (!active) {
                    // A refused write leaves the current workspace active; the
                    // sheet is already closed, so there is nothing to correct.
                    void setActive(profile.id).catch(() => undefined);
                  }
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
