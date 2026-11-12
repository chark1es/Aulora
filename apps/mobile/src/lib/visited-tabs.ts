import { useEffect, useMemo, useState } from "react";

/**
 * How many hub tabs may stay mounted behind the active one. Three covers the
 * usual Chats <-> Threads <-> You loop while releasing older tabs' live
 * queries instead of retaining every visited surface until session teardown.
 */
export const MAX_RETAINED_TABS = 3;

/**
 * How long a hidden hub tab may keep its subscriptions and loaded pages.
 *
 * The count cap only releases a tab when the reader opens enough other tabs;
 * without a lifetime a hidden Notes or Boards tab could stay subscribed for the
 * whole session. After a minute without a tab change the hidden tabs unmount,
 * which releases their queries and any pages they had loaded. This is a
 * source-level policy, not a measured busy-workspace result; see
 * `docs/convex/README.md`.
 */
export const HIDDEN_TAB_TTL_MS = 60_000;

/**
 * Marks a hub tab as the most recently used one. The active tab moves to the
 * end, so retention is MRU rather than insertion order. Once `limit` tabs are
 * retained, the oldest one is evicted; the active tab is always last, so it can
 * never be the one removed. Returns the same set when the tab is already the
 * most recent one, so an effect that runs on every visit does not churn React
 * state.
 */
export function visitTab<T extends string>(
  visited: ReadonlySet<T>,
  tab: T,
  limit: number = MAX_RETAINED_TABS,
): ReadonlySet<T> {
  const current = [...visited];
  if (current[current.length - 1] === tab) {
    return visited;
  }
  const bounded = Math.max(1, limit);
  const next = new Set(current.filter((entry) => entry !== tab));
  next.add(tab);
  while (next.size > bounded) {
    const oldest = next.values().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
}

/** The retained tabs left after the hidden lifetime expires: only the visible one. */
export function expireHiddenTabs<T extends string>(
  visited: ReadonlySet<T>,
  active: T,
): ReadonlySet<T> {
  return visited.has(active) ? new Set([active]) : visited;
}

/**
 * The tabs that stay in the tree: the active one plus every visited one that
 * the dock still offers. Filtering by `tabs` bounds the mounted set when an
 * addon disappears mid-session, and keeps the dock's order.
 */
export function mountedTabs<T extends string>(
  tabs: readonly T[],
  active: T,
  visited: ReadonlySet<string>,
): readonly T[] {
  return tabs.filter((tab) => tab === active || visited.has(tab));
}

export interface RetainedTabOptions {
  readonly limit?: number;
  /**
   * Keep hidden tabs mounted even past the lifetime, for example while a
   * retained Notes editor holds an unsaved draft that unmounting would delete.
   */
  readonly hold?: boolean;
  readonly hiddenTtlMs?: number;
}

/**
 * Retention shared by the hub renderer and the parent Threads query, so a tab
 * that is no longer mounted also stops subscribing.
 */
export function useRetainedTabs<T extends string>(
  tabs: readonly T[],
  active: T,
  options: RetainedTabOptions = {},
): readonly T[] {
  const limit = options.limit ?? MAX_RETAINED_TABS;
  const hiddenTtlMs = options.hiddenTtlMs ?? HIDDEN_TAB_TTL_MS;
  const hold = options.hold ?? false;
  const [visited, setVisited] = useState<ReadonlySet<T>>(() => new Set([active]));

  useEffect(() => {
    setVisited((current) => visitTab(current, active, limit));
  }, [active, limit]);

  useEffect(() => {
    if (hold || ![...visited].some((tab) => tab !== active)) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setVisited((current) => expireHiddenTabs(current, active));
    }, hiddenTtlMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, hiddenTtlMs, hold, visited]);

  return useMemo(() => mountedTabs(tabs, active, visited), [tabs, active, visited]);
}

/**
 * Whether the Threads inbox is the surface the reader can see. The hub keeps
 * its selected tab while a conversation pane covers it, so selecting Threads is
 * not enough to acknowledge the mentions shown there.
 */
export function threadsInboxVisible(hubTab: string, pane: number): boolean {
  return hubTab === "threads" && pane === 0;
}
