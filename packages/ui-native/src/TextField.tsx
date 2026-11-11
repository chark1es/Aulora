import { forwardRef } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { nativeFontStyle } from "./typography";

export type TextFieldProps = TextInputProps;

/**
 * A bare `TextInput` that draws the shipped Inter face for its weight class
 * and drops Android's font padding, so typed text matches `Text` everywhere.
 * An inline `fontWeight`/`fontStyle` picks the face too, as it does for `Text`.
 * Layout, colours and borders stay with the caller's classes.
 */
export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { className, style, ...rest },
  ref,
) {
  const flat: TextStyle = { ...StyleSheet.flatten(style) };
  const font = nativeFontStyle({
    className,
    fontWeight: flat.fontWeight,
    fontStyle: flat.fontStyle,
  });
  return (
    <TextInput
      ref={ref}
      {...(className !== undefined ? { className } : {})}
      style={[font, style]}
      {...rest}
    />
  );
});
