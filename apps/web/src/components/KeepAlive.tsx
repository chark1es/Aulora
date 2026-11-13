import { cn } from "@aulora/ui-web";
import type { ReactNode } from "react";

/**
 * Keeps a visited view in the tree and hides it while another view is active.
 *
 * This is what makes switching screens feel instantaneous: the hidden pane is
 * not unmounted, so its Convex subscriptions stay open and it renders its
 * already-loaded messages, notes or settings instead of a fresh spinner when
 * the reader comes back.
 */
export function KeepAlive({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("min-h-0 min-w-0 flex-1", active ? "flex" : "hidden")} aria-hidden={!active}>
      {children}
    </div>
  );
}
