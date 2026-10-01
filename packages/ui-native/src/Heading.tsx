import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "./cn";

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps extends RNTextProps {
  level?: HeadingLevel;
}

const LEVEL_CLASSES: Record<HeadingLevel, string> = {
  1: "text-3xl font-semibold tracking-tight",
  2: "text-2xl font-semibold tracking-tight",
  3: "text-base font-semibold",
};

/** Section heading; `level` picks the type size. */
export function Heading({ level = 2, className, ...rest }: HeadingProps) {
  return <RNText className={cn("text-text", LEVEL_CLASSES[level], className ?? "")} {...rest} />;
}
