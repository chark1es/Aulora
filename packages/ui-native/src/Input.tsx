import type { ReactNode } from "react";
import { TextInput, type TextInputProps, View } from "react-native";
import { cn } from "./cn";
import { Text } from "./Text";
import { usePalette } from "./theme";
import { type InputSize, inputClass } from "./variants";

export interface InputProps extends TextInputProps {
  /** Visible field label. */
  label: string;
  /** Optional helper text shown below the field. */
  hint?: string;
  /** Error message; switches the field to an error state. */
  error?: string;
  /**
   * Field height/type scale. `md` (default) is unchanged; `lg` uses 17px text
   * on a >=44pt target for Apple-appropriate entry screens.
   */
  size?: InputSize;
  /** Decorative element rendered inside the field, at the start. */
  leading?: ReactNode;
  /** Element rendered inside the field, at the end (for example a paste button). */
  trailing?: ReactNode;
}

/** Text input with a 14px radius, hairline border and token placeholder color. */
export function Input(props: InputProps) {
  const { label, hint, error, size, leading, trailing, className, style, ...rest } = props;
  const palette = usePalette();
  const insetStyle = {
    ...(leading !== undefined ? { paddingLeft: 40 } : {}),
    ...(trailing !== undefined ? { paddingRight: 72 } : {}),
  };
  return (
    <View className="w-full gap-1.5">
      <Text size="sm" tone="muted" className="font-medium">
        {label}
      </Text>
      <View className="relative w-full justify-center">
        {leading !== undefined && (
          <View className="absolute left-3 z-10" pointerEvents="none">
            {leading}
          </View>
        )}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={palette["text-muted"]}
          style={[insetStyle, style]}
          className={cn(
            inputClass({
              error: error !== undefined,
              ...(size !== undefined ? { size } : {}),
              className: className ?? "",
            }),
          )}
          {...rest}
        />
        {trailing !== undefined && <View className="absolute right-1.5 z-10">{trailing}</View>}
      </View>
      {hint !== undefined && (
        <Text size="xs" tone="muted">
          {hint}
        </Text>
      )}
      {error !== undefined && (
        <Text size="xs" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}
