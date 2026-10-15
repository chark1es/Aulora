import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { settingRowClass } from "./variants";

export interface SettingRowProps {
  readonly label: string;
  /** One-line detail under the label. */
  readonly description?: string | undefined;
  /** Trailing control: a `Switch`, a value, a chevron. */
  readonly control?: ReactNode;
  readonly onPress?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
}

/**
 * One row of a grouped settings list: label and description on the left, a
 * control on the right, a consistent >=44pt height. Group several inside a
 * surface that draws the separators.
 */
export function SettingRow(props: SettingRowProps) {
  const { label, description, control, disabled = false } = props;
  const body = (
    <>
      <View className="min-w-0 flex-1">
        <Text className="font-medium">{label}</Text>
        {description !== undefined && description.length > 0 && (
          <Text size="xs" tone="muted">
            {description}
          </Text>
        )}
      </View>
      {control}
    </>
  );
  if (props.onPress === undefined) {
    return <View className={settingRowClass({ disabled })}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      className={settingRowClass({ disabled, pressable: true })}
    >
      {body}
    </Pressable>
  );
}
