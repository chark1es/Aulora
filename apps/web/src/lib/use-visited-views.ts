import { useEffect, useMemo, useState } from "react";

/**
 * How many non-chat surfaces may stay mounted. Two keeps the common
 * back-and-forth (Notes -> Boards -> Notes) instant while still releasing older
 * live queries, which is the bounded retention the repository requires for
 * view-scoped subscriptions.
 */
export const MAX_RETAINED_VIEWS = 2;

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
 * The views that stay mounted, most recent last.
 *
 * A view leaves the set once enough other surfaces have been opened, so a
 * hidden Notes/Boards/Threads subscription cannot live for the whole session.
 * Its pane still keeps results and scroll position while retained; eviction
 * deliberately trades that for releasing live queries.
 */
export function useVisitedViews<T extends string>(
  active: T,
  limit: number = MAX_RETAINED_VIEWS,
): ReadonlySet<T> {
  const [retained, setRetained] = useState<readonly T[]>(() => [active]);

  useEffect(() => {
    setRetained((current) => retainView(current, active, limit));
  }, [active, limit]);

  return useMemo(() => new Set(retained), [retained]);
}
