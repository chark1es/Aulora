/**
 * How many hub tabs may stay mounted behind the active one. Three covers the
 * usual Chats <-> Threads <-> You loop while releasing older tabs' live
 * queries instead of retaining every visited surface until session teardown.
 */
export const MAX_RETAINED_TABS = 3;

/**
 * Marks a hub tab as visited. Returns the same set when the tab is already in
 * it, so an effect that runs on every visit does not churn React state. Once
 * `limit` tabs are retained, the oldest insertion is evicted; the active tab is
 * always added last, so it can never be the one removed.
 */
export function visitTab<T extends string>(
  visited: ReadonlySet<T>,
  tab: T,
  limit: number = MAX_RETAINED_TABS,
): ReadonlySet<T> {
  if (visited.has(tab)) {
    return visited;
  }
  const bounded = Math.max(1, limit);
  const next = new Set(visited);
  next.add(tab);
  while (next.size > bounded) {
    const oldest = next.values().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
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

/**
 * Whether the Threads inbox is the surface the reader can see. The hub keeps
 * its selected tab while a conversation pane covers it, so selecting Threads is
 * not enough to acknowledge the mentions shown there.
 */
export function threadsInboxVisible(hubTab: string, pane: number): boolean {
  return hubTab === "threads" && pane === 0;
}
