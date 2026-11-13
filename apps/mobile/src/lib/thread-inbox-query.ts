/**
 * The arguments the parent Threads inbox queries receive for the current
 * retention and capability state.
 *
 * The inbox is only subscribed while its hub tab is retained. When the tab is
 * evicted (or expires after `HIDDEN_TAB_TTL_MS`), both the legacy and paginated
 * queries skip, which releases the subscription and resets the paginated state
 * to its first page; returning later starts from 50 rows again. While retained,
 * the reader's extra pages stay loaded.
 */
export interface ThreadInboxQueryArgs {
  readonly legacy: { readonly limit: number } | "skip";
  readonly page: Record<string, never> | "skip";
}

export function threadInboxQueryArgs(
  runtimeReady: boolean,
  retained: boolean,
  paged: boolean,
): ThreadInboxQueryArgs {
  if (!runtimeReady || !retained) {
    return { legacy: "skip", page: "skip" };
  }
  return paged ? { legacy: "skip", page: {} } : { legacy: { limit: 50 }, page: "skip" };
}
