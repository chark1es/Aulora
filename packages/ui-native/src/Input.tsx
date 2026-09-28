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
}

/** Text input with a 14px radius, hairline border and token placeholder color. */
export function Input({ label, hint, error, size, className, ...rest }: InputProps) {
  const palette = usePalette();
  return (
    <View className="w-full gap-1.5">
      <Text size="sm" tone="muted" className="font-medium">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette["text-muted"]}
        className={cn(
          inputClass({
            error: error !== undefined,
            ...(size !== undefined ? { size } : {}),
            className: className ?? "",
          }),
        )}
        {...rest}
      />
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
