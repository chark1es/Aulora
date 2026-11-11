import {
  Text as RNText,
  type TextProps as RNTextProps,
  StyleSheet,
  type TextStyle,
} from "react-native";
import { cn } from "./cn";
import { nativeFontStyle } from "./typography";

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps extends RNTextProps {
  level?: HeadingLevel;
}

const LEVEL_CLASSES = new Map<HeadingLevel, string>([
  [1, "text-3xl font-semibold tracking-tight"],
  [2, "text-2xl font-semibold tracking-tight"],
  [3, "text-base font-semibold"],
]);

/** Section heading; `level` picks the type size. */
export function Heading({ level = 2, className, style, ...rest }: HeadingProps) {
  const classes = cn("text-text", LEVEL_CLASSES.get(level), className ?? "");
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const font = nativeFontStyle({
    className: classes,
    fontWeight: flat.fontWeight,
    fontStyle: flat.fontStyle,
  });
  return (
    <RNText
      ellipsizeMode="tail"
      style={[{ flexShrink: 1, minWidth: 0 }, font, style]}
      className={classes}
      {...rest}
    />
  );
}
