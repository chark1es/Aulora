import type { SVGProps } from "react";
import { cn } from "./cn";

export interface LogoProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Rendered size in pixels (square). */
  size?: number;
  /** Accessible name; when omitted the mark is decorative. */
  title?: string;
}

/**
 * The Aulora mark: a soft arched doorway (the hall) in Ember with a small
 * speech dot. `title` makes it a labelled image; otherwise it is decorative.
 */
export function Logo({ size = 32, title, className, ...rest }: LogoProps) {
  const labelled = title !== undefined;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={labelled ? "img" : "presentation"}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
      {...rest}
    >
      <path className="fill-accent" d="M9 43V25a15 15 0 0 1 30 0v18H9Z" />
      <path className="fill-bg" d="M16 43V26a8 8 0 0 1 16 0v17H16Z" />
      <circle className="fill-secondary" cx="37.5" cy="11.5" r="4" />
      <circle className="fill-bg" cx="37.5" cy="11.5" r="1.4" />
    </svg>
  );
}
