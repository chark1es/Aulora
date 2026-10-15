import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface SettingsRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly label: string;
  readonly description?: string;
  /** The control shown on the right; omit for a read-only row. */
  readonly children?: ReactNode;
  readonly align?: "center" | "start";
}

function SettingsRowLabel(props: { readonly label: string; readonly description?: string }) {
  const { label, description } = props;
  return (
    <>
      <span className="block text-[13px] font-medium text-text">{label}</span>
      {description !== undefined && (
        <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{description}</span>
      )}
    </>
  );
}

/** One settings row: label and description on the left, control on the right. */
export function SettingsRow(props: SettingsRowProps) {
  const { label, description, children, align = "center", className, ...rest } = props;
  const text = (
    <SettingsRowLabel label={label} {...(description !== undefined ? { description } : {})} />
  );
  return (
    <div
      className={cn(
        "flex justify-between gap-4 py-3",
        align === "start" ? "items-start" : "items-center",
        className,
      )}
      {...rest}
    >
      <div className="min-w-0 flex-1">{text}</div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export interface SettingsRowGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Draws hairline separators between the rows. */
  readonly children: ReactNode;
}

/** A bordered card of {@link SettingsRow}s with hairline separators. */
export function SettingsRowGroup({ className, children, ...rest }: SettingsRowGroupProps) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-2 px-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
