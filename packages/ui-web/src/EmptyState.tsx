import type { IconName } from "@aulora/tokens";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface EmptyStateProps {
  /** Glyph shown in the tinted tile. */
  readonly icon?: IconName;
  readonly title: string;
  readonly description?: string;
  /** One or more actions rendered in a row under the copy. */
  readonly action?: ReactNode;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

const TILE = new Map<NonNullable<EmptyStateProps["size"]>, string>([
  ["sm", "h-11 w-11 rounded-[13px]"],
  ["md", "h-14 w-14 rounded-[16px]"],
]);

/** The shared centred empty/zero-state: a tinted glyph, a title and a way forward. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 text-center",
        size === "md" ? "p-8" : "p-5",
        className,
      )}
    >
      {icon !== undefined && (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center bg-accent-soft text-accent",
            TILE.get(size),
          )}
        >
          <Icon name={icon} size={size === "md" ? 28 : 22} />
        </span>
      )}
      <h2 className={cn("font-semibold", size === "md" ? "text-lg" : "text-[15px]")}>{title}</h2>
      {description !== undefined && (
        <p className={cn("max-w-md text-text-muted", size === "md" ? "text-sm" : "text-[13px]")}>
          {description}
        </p>
      )}
      {action !== undefined && (
        <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
