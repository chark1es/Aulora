import type { PresenceRow } from "@aulora/core";
import { Button, Text } from "@aulora/ui-native";
import { useState } from "react";
import { Linking, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { presenceLabel } from "../../lib/presence";
import type { PushRegistrationState } from "../../lib/use-push-registration";
import { DeviceSettingsSection } from "../voice/DeviceSettingsSection";
import { PaneHeader, RoundButton, useDockClearance } from "./HubPane";
import { ListGroup, ListHeader, ListRow } from "./List";
import { PresenceAvatar } from "./PresenceAvatar";
import { ProfileEditor } from "./ProfileEditor";
import { SoundSettingsSection } from "./SoundSettingsSection";
import { StatusEditor } from "./StatusEditor";

type Page = "root" | "profile" | "notifications" | "voice";
type PresenceStatus = PresenceRow["status"];

const PAGE_TITLES: Record<Exclude<Page, "root">, string> = {
  profile: "Profile",
  notifications: "Notifications & sounds",
  voice: "Voice & video",
};

const PUSH_LABELS: Record<PushRegistrationState, string> = {
  idle: "Checking…",
  registering: "Registering…",
  registered: "On for this device",
  denied: "Off. Turn them on in system settings.",
  unavailable: "Unavailable on this build",
};

export interface SettingsViewProps {
  readonly workspaceName: string;
  readonly ownUserId: string;
  readonly ownDisplayName: string;
  readonly canChangeNickname: boolean;
  readonly hasAvatar: boolean;
  readonly onChangeAvatar: () => void;
  readonly onClearAvatar: () => void;
  readonly ownStatus: PresenceStatus;
  readonly ownCustomStatus: string;
  readonly pushState: PushRegistrationState;
  readonly onSetStatus: (status: PresenceStatus, customStatus?: string) => void;
  readonly onSignOut: () => void;
}

/** The hub's "You" tab: who you are here, how you show up, and this device's settings. */
export function SettingsView({
  workspaceName,
  ownUserId,
  ownDisplayName,
  canChangeNickname,
  hasAvatar,
  onChangeAvatar,
  onClearAvatar,
  ownStatus,
  ownCustomStatus,
  pushState,
  onSetStatus,
  onSignOut,
}: SettingsViewProps) {
  const clearance = useDockClearance();
  const [page, setPage] = useState<Page>("root");

  if (page !== "root") {
    return (
      <View className="flex-1" style={{ paddingBottom: clearance }}>
        <PaneHeader
          title={PAGE_TITLES[page]}
          leading={
            <RoundButton icon="chevron-left" label="Back to You" onPress={() => setPage("root")} />
          }
        />
        <View className="flex-1 px-4">
          {page === "profile" && (
            <KeyboardAwareScrollView
              bottomOffset={24}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <ProfileEditor userId={ownUserId} canChangeNickname={canChangeNickname} />
            </KeyboardAwareScrollView>
          )}
          {page === "notifications" && <SoundSettingsSection />}
          {page === "voice" && <DeviceSettingsSection />}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: clearance, gap: 18 }}
    >
      <View className="-mx-3">
        <PaneHeader title="You" subtitle={`Signed in to ${workspaceName}`} />
      </View>

      <View className="gap-4 rounded-card bg-surface-2 p-4">
        <View className="flex-row items-center gap-4">
          <PresenceAvatar userId={ownUserId} status={ownStatus} size={64} />
          <View className="min-w-0 flex-1">
            <Text size="lg" className="font-semibold" numberOfLines={1}>
              {ownDisplayName}
            </Text>
            <Text size="sm" tone="muted" numberOfLines={2}>
              {ownCustomStatus.length > 0
                ? ownCustomStatus
                : ownStatus === "offline"
                  ? "Invisible"
                  : presenceLabel(ownStatus)}
            </Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onPress={onChangeAvatar}>
            Change picture
          </Button>
          {hasAvatar && (
            <Button size="sm" variant="ghost" className="flex-1" onPress={onClearAvatar}>
              Use generated avatar
            </Button>
          )}
        </View>
      </View>

      <View>
        <ListHeader title="Status" />
        <View className="rounded-card bg-surface-2 p-4">
          <StatusEditor
            status={ownStatus}
            customStatus={ownCustomStatus}
            onSetStatus={onSetStatus}
          />
        </View>
      </View>

      <View>
        <ListHeader title="Settings" />
        <ListGroup>
          <ListRow
            icon="pencil"
            title="Profile"
            subtitle={canChangeNickname ? "Nickname and about you" : "About you"}
            chevron
            onPress={() => setPage("profile")}
          />
          <ListRow
            icon="bell"
            title="Notifications & sounds"
            subtitle={PUSH_LABELS[pushState]}
            chevron
            onPress={() => setPage("notifications")}
          />
          <ListRow
            icon="headphones"
            title="Voice & video"
            subtitle="Microphone, camera and call quality"
            chevron
            onPress={() => setPage("voice")}
          />
          <ListRow
            icon="settings"
            title="System notification settings"
            subtitle="Open this app's page in system settings"
            onPress={() => void Linking.openSettings()}
          />
          <ListRow
            icon="moon"
            title="Appearance"
            subtitle="Follows this device's light or dark mode"
          />
        </ListGroup>
      </View>

      <ListGroup>
        <ListRow
          icon="logout"
          title={`Sign out of ${workspaceName}`}
          tone="danger"
          onPress={onSignOut}
        />
      </ListGroup>
    </KeyboardAwareScrollView>
  );
}
