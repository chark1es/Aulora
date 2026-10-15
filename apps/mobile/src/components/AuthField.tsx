import { Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useState } from "react";
import { TextInput, type TextInputProps, View } from "react-native";

export interface AuthFieldProps extends TextInputProps {
  /** Visible label, set in small caps above the text. */
  readonly label: string;
  readonly error?: string;
  /** Decorative element before the text, e.g. an icon. */
  readonly leading?: ReactNode;
  /** Control after the text, e.g. a show-password button. */
  readonly trailing?: ReactNode;
}

/**
 * A field with no box: a small caps label, large text and a single rule under
 * it that turns to the accent on focus. Mirrors the web `AuthField`, so the
 * pre-session screens read as part of the page rather than a form widget.
 */
export function AuthField(props: AuthFieldProps) {
  const { label, error, leading, trailing, style, onFocus, onBlur, ...rest } = props;
  const palette = usePalette();
  const [focused, setFocused] = useState(false);
  const rule = error !== undefined ? palette.danger : focused ? palette.accent : palette.border;
  return (
    <View className="w-full gap-1.5">
      <Text size="xs" tone="muted" className="font-semibold uppercase tracking-[0.09em]">
        {label}
      </Text>
      <View
        className="flex-row items-center gap-2.5"
        style={{ borderBottomWidth: 2, borderBottomColor: rule }}
      >
        {leading}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={palette["text-muted"]}
          selectionColor={palette.accent}
          className="min-h-12 flex-1 text-[19px] text-text"
          style={style}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
        {trailing}
      </View>
      {error !== undefined && (
        <Text size="xs" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}
