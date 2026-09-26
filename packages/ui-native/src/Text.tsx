import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { type TextSize, type TextTone, textClass } from "./variants";

export type { TextSize, TextTone } from "./variants";

export interface TextProps extends RNTextProps {
  tone?: TextTone;
  size?: TextSize;
  mono?: boolean;
}

/** Body/meta text with token-driven tone, size and optional mono styling. */
export function Text({ tone, size, mono, className, ...rest }: TextProps) {
  const classes = textClass({
    ...(tone !== undefined ? { tone } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(mono !== undefined ? { mono } : {}),
    className: className ?? "",
  });
  return <RNText className={classes} {...rest} />;
}
