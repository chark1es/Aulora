/**
 * Marks a hub tab as visited. Returns the same set when the tab is already in
 * it, so an effect that runs on every visit does not churn React state.
 */
export function visitTab<T extends string>(visited: ReadonlySet<T>, tab: T): ReadonlySet<T> {
  if (visited.has(tab)) {
    return visited;
  }
  const next = new Set(visited);
  next.add(tab);
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
