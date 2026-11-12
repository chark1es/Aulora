import type { HTMLAttributes } from "react";
import { CapText } from "./CapText";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "success" | "danger" | "outline";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colour role; `neutral` is the default quiet pill. */
  tone?: BadgeTone;
  size?: BadgeSize;
}

const TONE_CLASSES = new Map<BadgeTone, string>([
  ["neutral", "bg-surface-3 text-text-muted"],
  ["accent", "bg-accent-soft text-accent-text"],
  ["success", "bg-secondary/15 text-secondary-text"],
  ["danger", "bg-danger/10 text-danger-text"],
  ["outline", "border border-border bg-transparent text-text-muted"],
]);

// text-centering-ok: size lookup only; the component wraps its label in <CapText>.
const SIZE_CLASSES = new Map<BadgeSize, string>([
  ["sm", "h-[18px] px-1.5 text-[10px]"],
  ["md", "h-5 px-2 text-[11px]"],
]);

/** A compact status pill for tables, lists and cards. */
export function Badge({ tone = "neutral", size = "md", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-medium",
        TONE_CLASSES.get(tone),
        SIZE_CLASSES.get(size),
        className,
      )}
      {...rest}
    >
      <CapText>{children}</CapText>
    </span>
  );
}
