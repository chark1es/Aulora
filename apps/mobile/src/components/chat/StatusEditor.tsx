import type { PresenceRow } from "@aulora/core";
import { Button, presenceColor, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
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
  readonly onSetStatus: (_status: PresenceStatus, _customStatus?: string) => void;
}

/**
 * The shared presence + custom-status editor used by both the members sheet and
 * the settings sheet, so the two surfaces cannot drift apart.
 */
export function StatusEditor({ status, customStatus, onSetStatus }: StatusEditorProps) {
  const palette = usePalette();
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

  const changed = draft.trim() !== customStatus;

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
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={() => {
                onSetStatus(option.value);
              }}
              className={`min-h-10 flex-row items-center gap-2 rounded-pill border px-3 active:opacity-70 ${
                active ? "border-accent bg-accent-soft" : "border-transparent bg-surface-3"
              }`}
            >
              <View
                className="h-2.5 w-2.5 rounded-pill"
                style={{ backgroundColor: presenceColor(option.value, palette) }}
              />
              <Text size="sm" tone={active ? "accent" : "default"} maxFontSizeMultiplier={1.4}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row items-center gap-2">
        <TextInput
          accessibilityLabel="Custom status"
          value={draft}
          onChangeText={setDraft}
          maxLength={80}
          placeholder="What are you up to?"
          placeholderTextColor={palette["text-muted"]}
          returnKeyType="done"
          onSubmitEditing={save}
          className="min-h-11 flex-1 rounded-input bg-surface-3 px-3 py-0 text-[17px] text-text"
        />
        {changed ? (
          <Button size="sm" variant="primary" onPress={save}>
            Save
          </Button>
        ) : (
          customStatus.length > 0 && (
            <Button size="sm" variant="secondary" onPress={clear}>
              Clear
            </Button>
          )
        )}
      </View>
    </View>
  );
}

export type { PresenceStatus };
export { STATUS_OPTIONS };
