import { useEffect, useState } from "react";

/**
 * The views that have been opened at least once.
 *
 * A view stays in the set after the reader moves on, so its pane can stay
 * mounted (see `KeepAlive`): its queries keep their results, its scroll
 * position survives and switching back does not show a loading spinner.
 */
export function useVisitedViews<T extends string>(active: T): ReadonlySet<T> {
  const [visited, setVisited] = useState<ReadonlySet<T>>(() => new Set([active]));

  useEffect(() => {
    setVisited((current) => {
      if (current.has(active)) {
        return current;
      }
      const next = new Set(current);
      next.add(active);
      return next;
    });
  }, [active]);

  return visited;
}
