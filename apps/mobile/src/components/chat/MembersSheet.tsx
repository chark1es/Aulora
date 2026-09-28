import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import type { PresenceRow } from "@aulora/core";
import { Button, Heading, Input, presenceColor, Text } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, View } from "react-native";
import { presenceLabel } from "../../lib/presence";

type PresenceStatus = PresenceRow["status"];

/**
 * Status switcher options. "offline" is offered as "Invisible" (web parity);
 * the rest reuse {@link presenceLabel} so member rows and buttons agree.
 */
const STATUS_OPTIONS: readonly { readonly value: PresenceStatus; readonly label: string }[] = [
  { value: "online", label: presenceLabel("online") },
  { value: "idle", label: presenceLabel("idle") },
  { value: "dnd", label: presenceLabel("dnd") },
  { value: "offline", label: "Invisible" },
];

export interface MembersSheetProps {
  readonly visible: boolean;
  readonly presence: readonly PresenceRow[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly onClose: () => void;
  readonly onSetStatus: (status: PresenceRow["status"], customStatus?: string) => void;
}

/** Bottom sheet with presence and a status switcher. */
export function MembersSheet({
  visible,
  presence,
  memberNames,
  ownUserId,
  onClose,
  onSetStatus,
}: MembersSheetProps) {
  const ownPresence = presence.find((row) => row.userId === ownUserId);
  const ownStatus: PresenceStatus = ownPresence?.status ?? "offline";
  const ownCustomStatus = ownPresence?.customStatus ?? "";
  const [customDraft, setCustomDraft] = useState(ownCustomStatus);

  // Re-seed the draft whenever the viewer's live custom status changes.
  useEffect(() => {
    setCustomDraft(ownCustomStatus);
  }, [ownCustomStatus]);

  const saveCustomStatus = () => {
    Keyboard.dismiss();
    onSetStatus(ownStatus, customDraft.trim());
  };
  const clearCustomStatus = () => {
    Keyboard.dismiss();
    setCustomDraft("");
    onSetStatus(ownStatus, "");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}} className="max-h-[70%] rounded-t-card bg-surface-1 p-4">
          <Heading level={3}>Members</Heading>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {STATUS_OPTIONS.map((option) => {
              const active = option.value === ownStatus;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={
                    active
                      ? "rounded-pill border border-accent bg-accent-soft px-3 py-1"
                      : "rounded-pill border border-border bg-surface-3 px-3 py-1"
                  }
                  onPress={() => onSetStatus(option.value)}
                >
                  <Text size="xs" tone={active ? "accent" : "default"}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View className="mt-3 gap-2">
            <Input
              label="Custom status"
              value={customDraft}
              onChangeText={setCustomDraft}
              maxLength={80}
              placeholder="Set a custom status…"
              returnKeyType="done"
              onSubmitEditing={saveCustomStatus}
            />
            <View className="flex-row gap-2">
              <Button size="sm" variant="primary" onPress={saveCustomStatus}>
                Save
              </Button>
              <Button size="sm" variant="secondary" onPress={clearCustomStatus}>
                Clear
              </Button>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
            {presence.map((row) => (
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}
