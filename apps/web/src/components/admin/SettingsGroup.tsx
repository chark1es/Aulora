import { cn } from "@aulora/ui-web";
import type { ReactNode } from "react";
import { SettingsSection, type SettingsSectionProps } from "./SettingsSection";

export interface SettingsGroupProps {
  readonly title?: string;
  readonly description?: string;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/** A grouped inset list: one elevation, hairline separators, tight rows. */
export function SettingsGroup(props: SettingsGroupProps) {
  const { title, description, trailing, children, className } = props;
  const list = (
    <div className="divide-y divide-border/60 border-y border-border/60">{children}</div>
  );
  if (title === undefined && trailing === undefined) {
    return <div className={className}>{list}</div>;
  }
  const section: SettingsSectionProps = {
    title: title ?? "",
    ...(description === undefined ? {} : { description }),
    ...(trailing === undefined ? {} : { trailing }),
    ...(className === undefined ? {} : { className }),
  };
  return <SettingsSection {...section}>{list}</SettingsSection>;
}

export interface SettingsGroupRowProps {
  readonly label: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly align?: "center" | "start";
  readonly className?: string;
}

/** One row of a {@link SettingsGroup}: label and description left, control right. */
export function SettingsGroupRow(props: SettingsGroupRowProps) {
  const { label, description, children, align = "center", className } = props;
  return (
    <div
      className={cn(
        "flex justify-between gap-4 px-4 py-3.5",
        align === "start" ? "items-start" : "items-center",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-text">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-[12px] leading-snug text-text-muted">
            {description}
          </span>
        )}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
