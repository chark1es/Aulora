import { darkPalette } from "@aulora/tokens";
import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** 16px pitch from the design spec. */
export const DOT_GRID_PITCH = 16;

export type DotGridProps = HTMLAttributes<HTMLDivElement>;

/**
 * Full-bleed background layer: the app canvas with a faint 1px dot grid on a
 * 16px pitch. Reads `--aulora-bg` / `--aulora-grid-dot` so it follows the
 * active theme, falling back to the dark palette outside the app.
 */
export function DotGrid({ className, style, ...rest }: DotGridProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 -z-10", className)}
      style={{
        backgroundColor: `var(--aulora-bg, ${darkPalette.bg})`,
        backgroundImage: `radial-gradient(circle, var(--aulora-grid-dot, ${darkPalette["grid-dot"]}) 1px, transparent 1px)`,
        backgroundSize: `${DOT_GRID_PITCH}px ${DOT_GRID_PITCH}px`,
        ...style,
      }}
      {...rest}
    />
  );
}
