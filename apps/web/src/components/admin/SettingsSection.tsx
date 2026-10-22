import { cn } from "@aulora/ui-web";
import type { ReactNode } from "react";

export interface SettingsSectionProps {
  readonly title: string;
  readonly description?: string;
  readonly trailing?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * A subsection inside an admin page: a small heading, an optional one-line
 * description and its content. The page header owns the page title, so this
 * stays deliberately quiet and repeats no glyph tiles.
 */
export function SettingsSection({
  title,
  description,
  trailing,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          {description !== undefined && (
            <p className="mt-0.5 text-[12px] leading-snug text-text-muted">{description}</p>
          )}
        </div>
        {trailing !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        )}
      </div>
      {children}
    </section>
  );
}
