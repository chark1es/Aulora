import { Icon } from "@aulora/ui-web";
import type { ReactNode } from "react";

export interface AdminBackLink {
  readonly label: string;
  readonly onClick: () => void;
}

export interface AdminPageHeaderProps {
  readonly title: string;
  readonly description?: string;
  /** Extra status line under the description, e.g. a live state dot. */
  readonly meta?: ReactNode;
  /** Draws a quiet breadcrumb-style back link above the title. */
  readonly back?: AdminBackLink;
  readonly trailing?: ReactNode;
}

/**
 * The one page header every workspace-settings page renders: an optional back
 * breadcrumb, a 20px title and a single-line description. Page titles live here
 * rather than in the sidebar or a second per-page header.
 */
export function AdminPageHeader({
  title,
  description,
  meta,
  back,
  trailing,
}: AdminPageHeaderProps) {
  return (
    <header className="flex flex-col gap-1">
      {back !== undefined && (
        <button
          type="button"
          onClick={back.onClick}
          className="-ml-1 mb-1 flex w-fit items-center gap-0.5 rounded-[6px] py-0.5 pr-1.5 pl-0.5 text-[12px] font-medium text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="chevron-left" size={14} />
          {back.label}
        </button>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-text">
            {title}
          </h1>
          {description !== undefined && (
            <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-text-muted">
              {description}
            </p>
          )}
          {meta !== undefined && <div className="mt-1.5">{meta}</div>}
        </div>
        {trailing !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        )}
      </div>
    </header>
  );
}
