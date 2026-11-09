import type { IconName } from "@aulora/tokens";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface EmptyStateProps {
  /**
   * Optional glyph that names the subject (a file type, a channel kind). It is
   * rendered small and monochrome; leave it out when it only repeats the title.
   */
  readonly icon?: IconName;
  readonly title: string;
  /** One concrete sentence about what belongs here and why it is empty. */
  readonly description?: string;
  /** Compact supporting content: two or three facts, steps or an example. */
  readonly details?: ReactNode;
  /** One or more actions rendered in a row under the copy. */
  readonly action?: ReactNode;
  readonly size?: "sm" | "md";
  /**
   * Follow the page grid (default) or centre inside a centred canvas. Start
   * alignment keeps the state on the same reading edge as the page header.
   */
  readonly align?: "start" | "center";
  readonly className?: string;
}

const TITLE = new Map<NonNullable<EmptyStateProps["size"]>, string>([
  ["sm", "text-[15px]"],
  ["md", "text-[16px]"],
]);

const COPY = "text-[13px] leading-relaxed";

const SPACE = new Map<NonNullable<EmptyStateProps["size"]>, string>([
  ["sm", "py-4"],
  ["md", "py-8"],
]);

/**
 * The shared zero-state: a plain, content-led block with a title, one concrete
 * sentence, an optional compact explanation and the way forward. It deliberately
 * avoids a decorative glyph tile; a passing icon stays small and monochrome.
 */
export function EmptyState({
  icon,
  title,
  description,
  details,
  action,
  size = "md",
  align = "start",
  className,
}: EmptyStateProps) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "flex flex-1 flex-col justify-center",
        SPACE.get(size),
        centered ? "items-center text-center" : "items-start",
        className,
      )}
    >
      <div
        className={cn(
          "flex w-full min-w-0 flex-col",
          centered ? "items-center" : "items-start",
          centered ? "max-w-md" : "max-w-[56ch]",
        )}
      >
        {icon !== undefined && <Icon name={icon} size={16} className="mb-2 text-text-muted" />}
        <h2 className={cn("font-semibold tracking-[-0.01em] text-text", TITLE.get(size))}>
          {title}
        </h2>
        {description !== undefined && (
          <p className={cn("mt-1 text-text-muted", COPY)}>{description}</p>
        )}
        {details !== undefined && <div className="mt-4 w-full text-[13px]">{details}</div>}
        {action !== undefined && (
          <div
            className={cn("mt-5 flex flex-wrap items-center gap-2", centered && "justify-center")}
          >
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
