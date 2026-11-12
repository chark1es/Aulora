import type { IconName } from "@aulora/tokens";
import { Icon } from "@aulora/ui-web";
import type { ReactNode } from "react";

/** A calm, centred full-page message for every dead end of a guest’s visit. */
export function GuestMessageScreen({
  icon,
  title,
  children,
  action,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10 text-center text-text">
      <span
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-text-muted"
      >
        <Icon name={icon} size={22} />
      </span>
      <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h1>
      {children !== undefined && (
        <div className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-text-muted">
          {children}
        </div>
      )}
      {action !== undefined && <div className="mt-6 flex items-center gap-2">{action}</div>}
    </main>
  );
}
