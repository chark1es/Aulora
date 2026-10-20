import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Optional size; `sm` matches dense menus. */
  readonly size?: "sm" | "md";
}

/** A keyboard-key cap used beside shortcut hints in menus and dialogs. */
export function Kbd({ size = "sm", className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-[5px] border border-border bg-surface-3 px-1.5 font-mono text-text-muted",
        size === "sm" ? "h-5 min-w-5 text-[10px]" : "h-6 min-w-6 text-[11px]",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
