import { Icon, type IconProps } from "@aulora/ui-web";
import type { ReactNode } from "react";

interface SectionProps {
  icon: IconProps["name"];
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}

/** A titled block in the card's main column. */
export function Section({ icon, title, aside, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex min-h-7 items-center gap-2">
        <Icon name={icon} size={15} className="text-text-muted" />
        <h3 className="flex-1 text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A labelled value in the card's sidebar. */
export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      {children}
    </div>
  );
}

export const field =
  "h-8 w-full min-w-0 rounded-[8px] border border-border bg-surface-3 px-2 text-[13px] text-text focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60";

/** A small button at the end of a row that shows on hover or focus. */
export const rowAction =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted opacity-0 transition hover:bg-surface-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none";
