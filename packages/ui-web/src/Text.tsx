import type { ElementType, HTMLAttributes } from "react";
import { cn } from "./cn";

export type TextTone = "default" | "muted" | "accent" | "secondary" | "danger";
export type TextSize = "xs" | "sm" | "base" | "md" | "lg";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  tone?: TextTone;
  size?: TextSize;
  mono?: boolean;
}

const TONE_CLASSES = new Map<TextTone, string>([
  ["default", "text-text"],
  ["muted", "text-text-muted"],
  ["accent", "text-accent"],
  ["secondary", "text-secondary"],
  ["danger", "text-danger"],
]);

const SIZE_CLASSES = new Map<TextSize, string>([
  ["xs", "text-xs"],
  ["sm", "text-sm"],
  ["base", "text-base"],
  ["md", "text-md"],
  ["lg", "text-lg"],
]);

/** Body/meta text with token-driven tone, size and optional mono styling. */
export function Text({
  as: Tag = "p",
  tone = "default",
  size = "base",
  mono = false,
  className,
  children,
  ...rest
}: TextProps) {
  return (
    <Tag
      className={cn(TONE_CLASSES.get(tone), SIZE_CLASSES.get(size), mono && "font-mono", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
