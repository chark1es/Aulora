/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { IconName } from "@aulora/tokens";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { Switch } from "./Switch";

export interface DialogSectionProps {
  readonly title: string;
  /** One line under the title, for what the section changes. */
  readonly hint?: string;
  /** Right side of the title row, e.g. a count or a small action. */
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A titled group inside a dialog body. No box: sections are separated by space
 * and a hairline above, so a dialog reads as one sheet instead of nested cards.
 */
export function DialogSection(props: DialogSectionProps) {
  const { title, hint, trailing, children, className } = props;
  return (
    <section
      className={cn(
        "flex flex-col gap-3 border-t border-border/60 pt-5 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-text">{title}</h3>
          {hint !== undefined && (
            <p className="mt-0.5 text-[12.5px] leading-snug text-text-muted">{hint}</p>
          )}
        </div>
        {trailing !== undefined && (
          <div className="flex shrink-0 items-center gap-2 text-[12px] text-text-muted">
            {trailing}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export interface DialogToggleRowProps {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly disabled?: boolean;
  /** Tints the glyph tile while on, e.g. danger for a destructive mode. */
  readonly tone?: "accent" | "danger";
}

/**
 * A setting in a dialog: a glyph tile, a title with one line of explanation, and
 * a switch. The tile takes the accent while the setting is on, so the state is
 * readable from the row as well as the switch.
 */
export function DialogToggleRow(props: DialogToggleRowProps) {
  const { icon, title, description, checked, onChange, disabled = false, tone = "accent" } = props;
  const on = tone === "danger" ? "bg-danger/[0.12] text-danger" : "bg-accent/[0.12] text-accent";
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-colors",
          checked ? on : "bg-surface-3 text-text-muted",
        )}
      >
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-text-muted">{description}</span>
      </span>
      <Switch bare label={title} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}
