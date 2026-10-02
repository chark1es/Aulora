/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
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

type DetailPage = "profile" | "notifications" | "voice";
type PresenceStatus = PresenceRow["status"];

const PAGE_TITLES: ReadonlyMap<DetailPage, string> = new Map([
  ["profile", "Profile"],
  ["notifications", "Notifications & sounds"],
  ["voice", "Voice & video"],
]);

const PUSH_LABELS: ReadonlyMap<PushRegistrationState, string> = new Map([
  ["idle", "Checking…"],
  ["registering", "Registering…"],
  ["registered", "On for this device"],
  ["denied", "Off. Turn them on in system settings."],
  ["unavailable", "Unavailable on this build"],
]);

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

interface DetailProps {
  readonly page: DetailPage;
  readonly ownUserId: string;
  readonly canChangeNickname: boolean;
  readonly onBack: () => void;
}

/** One settings page pushed over the You tab, with a way back. */
function SettingsDetail({ page, ownUserId, canChangeNickname, onBack }: DetailProps) {
  const clearance = useDockClearance();
  return (
    <View className="flex-1" style={{ paddingBottom: clearance }}>
      <PaneHeader
        title={PAGE_TITLES.get(page) ?? ""}
        leading={<RoundButton icon="chevron-left" label="Back to You" onPress={onBack} />}
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

interface IdentityCardProps {
  readonly userId: string;
  readonly displayName: string;
  readonly status: PresenceStatus;
  readonly customStatus: string;
  readonly hasAvatar: boolean;
  readonly onChangeAvatar: () => void;
  readonly onClearAvatar: () => void;
}

/** Who you are here: picture, name and how you currently show up. */
function IdentityCard(props: IdentityCardProps) {
  const { status, customStatus } = props;
  const showsAs =
    customStatus.length > 0
      ? customStatus
      : status === "offline"
        ? "Invisible"
        : presenceLabel(status);
  return (
    <View className="gap-4 rounded-card bg-surface-2 p-4">
      <View className="flex-row items-center gap-4">
        <PresenceAvatar userId={props.userId} status={status} size={64} />
        <View className="min-w-0 flex-1">
          <Text size="lg" className="font-semibold" numberOfLines={1}>
            {props.displayName}
          </Text>
          <Text size="sm" tone="muted" numberOfLines={2}>
            {showsAs}
          </Text>
        </View>
      </View>
      <View className="flex-row gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onPress={props.onChangeAvatar}>
          Change picture
        </Button>
        {props.hasAvatar && (
          <Button size="sm" variant="ghost" className="flex-1" onPress={props.onClearAvatar}>
            Use generated avatar
          </Button>
        )}
      </View>
    </View>
  );
}

interface StatusCardProps {
  readonly status: PresenceStatus;
  readonly customStatus: string;
  readonly onSetStatus: (status: PresenceStatus, customStatus?: string) => void;
}

function StatusCard({ status, customStatus, onSetStatus }: StatusCardProps) {
  return (
    <View>
      <ListHeader title="Status" />
      <View className="rounded-card bg-surface-2 p-4">
        <StatusEditor status={status} customStatus={customStatus} onSetStatus={onSetStatus} />
      </View>
    </View>
  );
}

interface SettingsMenuProps {
  readonly canChangeNickname: boolean;
  readonly pushState: PushRegistrationState;
  readonly onOpen: (page: DetailPage) => void;
}

/** The rows that lead to each settings page. */
function SettingsMenu({ canChangeNickname, pushState, onOpen }: SettingsMenuProps) {
  return (
    <View>
      <ListHeader title="Settings" />
      <ListGroup>
        <ListRow
          icon="pencil"
          title="Profile"
          subtitle={canChangeNickname ? "Nickname and about you" : "About you"}
          chevron
          onPress={() => {
            onOpen("profile");
          }}
        />
        <ListRow
          icon="bell"
          title="Notifications & sounds"
          subtitle={PUSH_LABELS.get(pushState)}
          chevron
          onPress={() => {
            onOpen("notifications");
          }}
        />
        <ListRow
          icon="headphones"
          title="Voice & video"
          subtitle="Microphone, camera and call quality"
          chevron
          onPress={() => {
            onOpen("voice");
          }}
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
  );
}

/** The hub's "You" tab: who you are here, how you show up, and this device's settings. */
export function SettingsView(props: SettingsViewProps) {
  const clearance = useDockClearance();
  const [page, setPage] = useState<DetailPage | null>(null);

  if (page !== null) {
    return (
      <SettingsDetail
        page={page}
        ownUserId={props.ownUserId}
        canChangeNickname={props.canChangeNickname}
        onBack={() => {
          setPage(null);
        }}
      />
    );
  }

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: clearance, gap: 18 }}
    >
      <View className="-mx-3">
        <PaneHeader title="You" subtitle={`Signed in to ${props.workspaceName}`} />
      </View>
      <IdentityCard
        userId={props.ownUserId}
        displayName={props.ownDisplayName}
        status={props.ownStatus}
        customStatus={props.ownCustomStatus}
        hasAvatar={props.hasAvatar}
        onChangeAvatar={props.onChangeAvatar}
        onClearAvatar={props.onClearAvatar}
      />
      <StatusCard
        status={props.ownStatus}
        customStatus={props.ownCustomStatus}
        onSetStatus={props.onSetStatus}
      />
      <SettingsMenu
        canChangeNickname={props.canChangeNickname}
        pushState={props.pushState}
        onOpen={setPage}
      />
      <ListGroup>
        <ListRow
          icon="logout"
          title={`Sign out of ${props.workspaceName}`}
          tone="danger"
          onPress={props.onSignOut}
        />
      </ListGroup>
    </KeyboardAwareScrollView>
  );
}
