import type { PresenceRow } from "@aulora/core";
import { Button, Input, Text } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";
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

export interface StatusEditorProps {
  readonly status: PresenceStatus;
  readonly customStatus: string;
  readonly onSetStatus: (status: PresenceStatus, customStatus?: string) => void;
}

/**
 * The shared presence + custom-status editor used by both the members sheet and
 * the settings sheet, so the two surfaces cannot drift apart.
 */
export function StatusEditor({ status, customStatus, onSetStatus }: StatusEditorProps) {
  const [draft, setDraft] = useState(customStatus);

  // Re-seed the draft whenever the viewer's live custom status changes.
  useEffect(() => {
    setDraft(customStatus);
  }, [customStatus]);

  const save = () => {
    Keyboard.dismiss();
    onSetStatus(status, draft.trim());
  };
  const clear = () => {
    Keyboard.dismiss();
    setDraft("");
    onSetStatus(status, "");
  };

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => {
          const active = option.value === status;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSetStatus(option.value)}
              className={
                active
                  ? "rounded-pill border border-accent bg-accent-soft px-3 py-1"
                  : "rounded-pill border border-border bg-surface-3 px-3 py-1"
              }
            >
              <Text size="xs" tone={active ? "accent" : "default"}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label="Custom status"
        value={draft}
        onChangeText={setDraft}
        maxLength={80}
        placeholder="Set a custom status…"
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <View className="flex-row gap-2">
        <Button size="sm" variant="primary" onPress={save}>
          Save
        </Button>
        <Button size="sm" variant="secondary" onPress={clear}>
          Clear
        </Button>
      </View>
    </View>
  );
}

export type { PresenceStatus };
export { STATUS_OPTIONS };
