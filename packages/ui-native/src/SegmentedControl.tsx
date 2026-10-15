import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { segmentedOptionClass, segmentedTrackClass } from "./variants";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Visible label above the control. */
  readonly label?: string | undefined;
  readonly disabled?: boolean | undefined;
}

/**
 * A small set of mutually exclusive choices shown as pills. Every option keeps
 * a 44pt target. Rendered label-less by default; pass `label` when the control
 * sits alone in a form.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const { options, value, onChange, label, disabled = false } = props;
  const control = (
    <View accessibilityRole="radiogroup" className={segmentedTrackClass()}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => {
              onChange(option.value);
            }}
            className={segmentedOptionClass({ active, disabled })}
          >
            <Text size="sm" tone={active ? "accent" : "muted"} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  if (label === undefined) return control;
  return (
    <View className="gap-1.5">
      <Text size="sm" className="font-medium">
        {label}
      </Text>
      {control}
    </View>
  );
}
