import type { MessagePayload, Paginated } from "@aulora/core";

/** One live page subscription (the shape Convex's `watchQuery` exposes). */
export interface ThreadPageWatch {
  localQueryResult(): Paginated<MessagePayload> | undefined;
  onUpdate(listener: () => void): () => void;
}

/** Bounds each visible thread window to 300 replies (3 pages of 100). */
export const MAX_THREAD_PAGES = 3;

/**
 * Watches a bounded window of replies oldest first. The final page stays live.
 * At the cap, reports a cursor so the viewer can advance to later replies;
 * newest replies beyond the current window require loading the next window.
 */
export function watchAllThreadPages(
  watchPage: (cursor: string | null) => ThreadPageWatch,
  onChange: (messages: readonly MessagePayload[]) => void,
  options?: {
    cursor: string | null;
    onPage: (nextCursor: string | null) => void;
    onError?: (cause: unknown) => void;
  },
): () => void {
  const pages = new Map<number, readonly MessagePayload[]>();
  const subscriptions = new Map<number, () => void>();
  let stopped = false;

  const emit = () => {
    const ordered = [...pages.keys()].sort((a, b) => a - b);
    onChange(ordered.flatMap((index) => pages.get(index) ?? []));
  };

  const subscribe = (index: number, cursor: string | null) => {
    if (stopped || subscriptions.has(index)) {
      return;
    }
    const watch = watchPage(cursor);
    const receive = () => {
      if (stopped) {
        return;
      }
      let value: Paginated<MessagePayload> | undefined;
      try {
        value = watch.localQueryResult();
      } catch (cause) {
        options?.onError?.(cause);
        return;
      }
      if (value === undefined) {
        return;
      }
      pages.set(index, value.page);
      emit();
      if (value.isDone || index + 1 === MAX_THREAD_PAGES) {
        options?.onPage(value.isDone ? null : value.continueCursor);
      }
      if (!value.isDone && !subscriptions.has(index + 1) && index + 1 < MAX_THREAD_PAGES) {
        subscribe(index + 1, value.continueCursor);
      }
    };
    subscriptions.set(index, watch.onUpdate(receive));
    receive();
  };

  subscribe(0, options?.cursor ?? null);
  return () => {
    stopped = true;
    for (const unsubscribe of subscriptions.values()) {
      unsubscribe();
    }
    subscriptions.clear();
    pages.clear();
  };
}
