import type { PresenceRow } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import type { PushRegistrationState } from "../../lib/use-push-registration";
import { DeviceSettingsSection } from "../voice/DeviceSettingsSection";
import { MemberAvatar } from "./MemberAvatar";
import { ProfileEditor } from "./ProfileEditor";
import { Sheet } from "./Sheet";
import { SoundSettingsSection } from "./SoundSettingsSection";
import { StatusEditor } from "./StatusEditor";

type SettingsCategory = "profile" | "notifications" | "voice" | "appearance";

const CATEGORIES: readonly { readonly key: SettingsCategory; readonly label: string }[] = [
  { key: "profile", label: "Account" },
  { key: "notifications", label: "Notifications & sounds" },
  { key: "voice", label: "Voice & video" },
  { key: "appearance", label: "Appearance" },
];

type PresenceStatus = PresenceRow["status"];

const PUSH_LABELS: Record<PushRegistrationState, string> = {
  idle: "Checking…",
  registering: "Registering…",
  registered: "Push notifications are registered on this device.",
  denied: "Notifications are off for Aulora. Enable them in system settings.",
  unavailable: "Push registration is unavailable on this build.",
};

export interface SettingsSheetProps {
  readonly visible: boolean;
  readonly ownUserId: string;
  readonly ownDisplayName: string;
  readonly canChangeNickname: boolean;
  readonly hasAvatar?: boolean;
  readonly onChangeAvatar?: () => void;
  readonly onClearAvatar?: () => void;
  readonly ownStatus: PresenceStatus;
  readonly ownCustomStatus: string;
  readonly pushState: PushRegistrationState;
  readonly onSetStatus: (status: PresenceStatus, customStatus?: string) => void;
  readonly onSignOut: () => void;
  readonly onClose: () => void;
}

/** The general settings surface: profile, notifications & sounds, voice, appearance. */
export function SettingsSheet({
  visible,
  ownUserId,
  ownDisplayName,
  canChangeNickname,
  hasAvatar = false,
  onChangeAvatar,
  onClearAvatar,
  ownStatus,
  ownCustomStatus,
  pushState,
  onSetStatus,
  onSignOut,
  onClose,
}: SettingsSheetProps) {
  const palette = usePalette();
  const [category, setCategory] = useState<SettingsCategory>("profile");

  return (
    <Sheet visible={visible} title="Settings" onClose={onClose}>
      <View className="flex-1 p-4">
        <View className="mt-3 flex-row flex-wrap gap-2">
          {CATEGORIES.map((entry) => {
            const active = entry.key === category;
            return (
              <Pressable
                key={entry.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setCategory(entry.key)}
                className={
                  active
                    ? "min-h-12 items-center justify-center rounded-pill border border-accent bg-accent-soft px-3 py-1"
                    : "min-h-12 items-center justify-center rounded-pill border border-border bg-surface-3 px-3 py-1"
                }
              >
                <Text size="xs" tone={active ? "accent" : "default"}>
                  {entry.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-4 flex-1">
          {category === "profile" && (
            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
              <View className="flex-row items-center gap-3">
                <MemberAvatar userId={ownUserId} size={56} title={ownDisplayName} />
                <View className="min-w-0 flex-1 gap-2">
                  <Text size="sm" className="font-medium">
                    {ownDisplayName}
                  </Text>
                  <Text size="xs" tone="muted">
                    Profile picture for this workspace.
                  </Text>
                  {onChangeAvatar !== undefined && (
                    <Button size="sm" variant="secondary" onPress={onChangeAvatar}>
                      Change picture
                    </Button>
                  )}
                  {hasAvatar && onClearAvatar !== undefined && (
                    <Button size="sm" variant="ghost" onPress={onClearAvatar}>
                      Use generated avatar
                    </Button>
                  )}
                </View>
              </View>
              <ProfileEditor userId={ownUserId} canChangeNickname={canChangeNickname} />
              <StatusEditor
                status={ownStatus}
                customStatus={ownCustomStatus}
                onSetStatus={onSetStatus}
              />
              <View className="mt-4 border-t border-border pt-4">
                <Button variant="danger" onPress={onSignOut}>
                  Sign out
                </Button>
              </View>
            </ScrollView>
          )}

          {category === "notifications" && (
            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
              <View className="rounded-input border border-border bg-surface-2 p-3">
                <View className="flex-row items-center gap-2">
                  <Icon name="bell" size={16} color={palette.accent} />
                  <Text size="sm" className="font-medium">
                    Push notifications
                  </Text>
                </View>
                <Text size="xs" tone="muted" className="mt-1">
                  {PUSH_LABELS[pushState]}
                </Text>
              </View>
              <Button variant="secondary" onPress={() => void Linking.openSettings()}>
                Open notification settings
              </Button>
              <SoundSettingsSection />
            </ScrollView>
          )}

          {category === "voice" && <DeviceSettingsSection />}

          {category === "appearance" && (
            <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
              <Text size="sm">Theme</Text>
              <Text size="xs" tone="muted">
                Aulora follows your device's light or dark appearance automatically.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Sheet>
  );
}
