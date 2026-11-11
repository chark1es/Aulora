import { Pressable, View } from "react-native";
import type { Fn } from "./function-type";
import { Switch } from "./Switch";
import { Text } from "./Text";
import { settingRowClass } from "./variants";

export interface SwitchRowProps {
  readonly label: string;
  /** One-line detail under the label; also read as the accessibility hint. */
  readonly description?: string | undefined;
  readonly value: boolean;
  readonly onValueChange: Fn<[value: boolean], void>;
  readonly disabled?: boolean | undefined;
  /** Extra classes for the row, e.g. a border when it stands alone in a form. */
  readonly className?: string | undefined;
}

/**
 * A settings toggle whose whole row is the target. The platform switch is only
 * ~32-35dp tall, so the row (label included) carries the >=44pt hit area and a
 * single `switch` element for screen readers; the switch itself is decoration
 * that still responds to a direct tap or drag.
 */
export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  className,
}: SwitchRowProps) {
  const hasDescription = description !== undefined && description.length > 0;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      {...(hasDescription ? { accessibilityHint: description } : {})}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        onValueChange(!value);
      }}
      className={settingRowClass({ disabled, pressable: true, className: className ?? "" })}
    >
      <View className="min-w-0 flex-1">
        <Text className="font-medium">{label}</Text>
        {hasDescription && (
          <Text size="xs" tone="muted">
            {description}
          </Text>
        )}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch value={value} disabled={disabled} onValueChange={onValueChange} />
      </View>
    </Pressable>
  );
}
