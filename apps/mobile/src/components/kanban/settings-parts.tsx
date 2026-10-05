/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Icon, Text, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Pressable, Switch, View } from "react-native";

/** A bare text field inside a row of the settings lists. */
export const cell =
  "min-h-11 rounded-input border border-border bg-surface-3 px-3 text-[16px] text-text";

interface ToggleProps {
  readonly label: string;
  readonly description: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}

export function Toggle({ label, description, value, onChange }: ToggleProps) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-3">
      <View className="min-w-0 flex-1">
        <Text className="font-medium">{label}</Text>
        <Text size="xs" tone="muted">
          {description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.accent, false: palette["surface-3"] }}
      />
    </View>
  );
}

export function Group({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="font-semibold" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

interface RowButtonProps {
  readonly label: string;
  readonly icon: "arrow-up" | "arrow-down" | "trash";
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

/** A small icon button at the end of a column or label row. */
export function RowButton({ label, icon, disabled = false, onPress }: RowButtonProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      className={`h-10 w-9 items-center justify-center rounded-input active:bg-surface-3 ${
        disabled ? "opacity-30" : ""
      }`}
    >
      <Icon
        name={icon}
        size={18}
        color={icon === "trash" ? palette.danger : palette["text-muted"]}
      />
    </Pressable>
  );
}
