import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
}

const LEVEL_CLASSES: Record<HeadingLevel, string> = {
  1: "text-3xl font-semibold tracking-tight",
  2: "text-2xl font-semibold tracking-tight",
  3: "text-xl font-semibold",
};

/** Section heading; `level` picks both the tag and the type size. */
export function Heading({ level = 2, className, children, ...rest }: HeadingProps) {
  const Tag = `h${level}` as const satisfies "h1" | "h2" | "h3";
  return (
    <Tag className={cn("text-text", LEVEL_CLASSES[level], className)} {...rest}>
      {children}
    </Tag>
  );
}
