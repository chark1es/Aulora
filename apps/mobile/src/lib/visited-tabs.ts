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
