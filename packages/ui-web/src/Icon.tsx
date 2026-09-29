import { type IconName, iconPaths } from "@aulora/tokens";
import type { SVGProps } from "react";
import { cn } from "./cn";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  /** Rendered size in pixels (square). */
  size?: number;
  strokeWidth?: number;
  /** Renders as a block element so it never adds inline baseline space. */
  block?: boolean;
  /** Baseline alignment when sitting inline with text. */
  align?: "baseline" | "middle" | "text-top" | "text-bottom";
}

/** A shared stroke icon from `@aulora/tokens`; decorative, colored by `currentColor`. */
export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  block = false,
  align,
  className,
  style,
  ...rest
}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0 align-middle", block && "block", className)}
      style={align !== undefined ? { verticalAlign: align, ...style } : style}
      {...rest}
    >
      {iconPaths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
