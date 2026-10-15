import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TooltipProps {
  /** Text revealed on hover and to assistive tech. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A native-title tooltip wrapper. It keeps a short hint attached to an
 * otherwise icon-only control without shipping a popper, so it behaves the
 * same in the web and desktop builds.
 */
export function Tooltip({ label, children, className }: TooltipProps) {
  return (
    <span title={label} className={cn("inline-flex", className)}>
      {children}
    </span>
  );
}
