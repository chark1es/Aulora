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

export interface VisitedViewOptions {
  readonly limit?: number;
  /**
   * Keep hidden views mounted even past the lifetime, for example while a
   * retained Notes editor holds an unsaved draft that unmounting would delete.
   */
  readonly hold?: boolean;
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

/** The retained views left after the hidden lifetime expires: only the one on screen. */
export function expireHiddenViews<T extends string>(
  current: readonly T[],
  active: T,
): readonly T[] {
  return current.includes(active) ? [active] : current;
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
  options: VisitedViewOptions = {},
): ReadonlySet<T> {
  const limit = options.limit ?? MAX_RETAINED_VIEWS;
  const hiddenTtlMs = options.hiddenTtlMs ?? HIDDEN_VIEW_TTL_MS;
  const hold = options.hold ?? false;
  const [retained, setRetained] = useState<readonly T[]>(() => [active]);

  useEffect(() => {
    setRetained((current) => retainView(current, active, limit));
  }, [active, limit]);

  useEffect(() => {
    if (hold || !retained.some((view) => view !== active)) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setRetained((current) => expireHiddenViews(current, active));
    }, hiddenTtlMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, hiddenTtlMs, hold, retained]);

  return useMemo(() => new Set(retained), [retained]);
}
