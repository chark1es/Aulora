import {
  Text as RNText,
  type TextProps as RNTextProps,
  StyleSheet,
  type TextStyle,
} from "react-native";
import { nativeFontStyle } from "./typography";
import { type TextSize, type TextTone, textClass } from "./variants";

export type { TextSize, TextTone } from "./variants";

export interface TextProps extends RNTextProps {
  tone?: TextTone;
  size?: TextSize;
  mono?: boolean;
}

/** Body/meta text with token-driven tone, size and optional mono styling. */
export function Text({ tone, size, mono, className, style, ...rest }: TextProps) {
  const classes = textClass({
    ...(tone !== undefined ? { tone } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(mono !== undefined ? { mono } : {}),
    className: className ?? "",
  });
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const font = nativeFontStyle({
    className: classes,
    fontWeight: flat.fontWeight,
    fontStyle: flat.fontStyle,
    mono,
  });
  return (
    <RNText
      className={classes}
      ellipsizeMode="tail"
      style={[{ flexShrink: 1, minWidth: 0 }, font, style]}
      {...rest}
    />
  );
}
