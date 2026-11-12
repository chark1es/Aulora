import { useEffect, useMemo, useState } from "react";

/**
 * How many non-chat surfaces may stay mounted. Two keeps the common
 * back-and-forth (Notes -> Boards -> Notes) instant while still releasing older
 * live queries, which is the bounded retention the repository requires for
 * view-scoped subscriptions.
 */
export const MAX_RETAINED_VIEWS = 2;

/**
 * How long a hidden surface may keep its subscriptions and loaded pages.
 *
 * The count cap only releases a view when the reader opens enough other
 * surfaces; without a lifetime a hidden Notes/Boards view could stay subscribed
 * for the whole session. A minute keeps ordinary tab switching instant and then
 * unmounts the hidden pane, which releases its query subscriptions and drops
 * any pages it had loaded. This is a source-level policy, not a measured
 * busy-channel result; see `docs/convex/README.md`.
 */
export const HIDDEN_VIEW_TTL_MS = 60_000;

export interface VisitedViewOptions<T extends string> {
  readonly limit?: number;
  /**
   * A *hidden* view to keep mounted past the lifetime because unmounting would
   * delete an unsaved draft, which today is only the Notes editor. The
   * exemption is deliberately per-view: every unrelated hidden surface still
   * expires, and an active Notes editor needs no exemption because the active
   * view is never evicted.
   */
  readonly holdView?: T | undefined;
  readonly hiddenTtlMs?: number;
}

/**
 * Adds `active` as the most recently used view and evicts the oldest entries
 * beyond `limit`. Returns the same array when nothing changed so React can bail
 * out of the re-render.
 */
export function retainView<T extends string>(
  current: readonly T[],
  active: T,
  limit: number = MAX_RETAINED_VIEWS,
): readonly T[] {
  const bounded = Math.max(1, limit);
  if (current[current.length - 1] === active) {
    return current;
  }
  const next = [...current.filter((view) => view !== active), active];
  return next.length > bounded ? next.slice(next.length - bounded) : next;
}

/**
 * The retained views left after the hidden lifetime expires: only the one on
 * screen plus an explicitly held hidden view (a dirty Notes draft). Everything
 * else hidden is released, so an unsaved Notes draft cannot keep unrelated
 * Boards/Threads subscriptions alive.
 */
export function expireHiddenViews<T extends string>(
  current: readonly T[],
  active: T,
  holdView?: T,
): readonly T[] {
  if (!current.includes(active)) return current;
  return current.filter((view) => view === active || view === holdView);
}

/**
 * The views that stay mounted, most recent last.
 *
 * A view leaves the set once enough other surfaces have been opened, or after
 * {@link HIDDEN_VIEW_TTL_MS} hidden, so a hidden Notes/Boards/Threads
 * subscription cannot live for the whole session. Its pane still keeps results,
 * scroll position and an unsaved draft while retained; eviction deliberately
 * trades that for releasing live queries.
 */
export function useVisitedViews<T extends string>(
  active: T,
  options: VisitedViewOptions<T> = {},
): ReadonlySet<T> {
  const limit = options.limit ?? MAX_RETAINED_VIEWS;
  const hiddenTtlMs = options.hiddenTtlMs ?? HIDDEN_VIEW_TTL_MS;
  const holdView = options.holdView;
  const [retained, setRetained] = useState<readonly T[]>(() => [active]);

  useEffect(() => {
    setRetained((current) => retainView(current, active, limit));
  }, [active, limit]);

  useEffect(() => {
    // Only a hidden view can be protected by the draft exemption; when Notes is
    // the active surface the other hidden panes must still expire. If nothing
    // hidden is expirable (only the active view, or just the held hidden view),
    // there is nothing to schedule.
    const expirable = retained.some((view) => view !== active && view !== holdView);
    if (!expirable) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setRetained((current) => expireHiddenViews(current, active, holdView));
    }, hiddenTtlMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, hiddenTtlMs, holdView, retained]);

  return useMemo(() => new Set(retained), [retained]);
}
