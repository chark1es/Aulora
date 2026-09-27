import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Slightly stronger surface for the focused/active state. */
  elevated?: boolean;
}

/** Soft-cornered surface with a hairline border and no heavy shadow. */
export function Card({ elevated = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface-2 p-5",
        elevated && "bg-surface-3",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
