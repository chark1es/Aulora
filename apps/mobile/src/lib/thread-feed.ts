import type { MessagePayload } from "@aulora/core";
import type { ChatSurfaceRuntime } from "./chat-surface";

/** Retains loaded windows and commits only the newest hydrated snapshot. */
export function watchThreadFeed(
  runtime: Pick<ChatSurfaceRuntime, "watchThread" | "session">,
  rootId: string,
  onChange: (messages: readonly MessagePayload[]) => void,
  onPage: (cursor: string | null) => void,
  onStatus: (status: { loading: boolean; error: boolean }) => void = () => undefined,
) {
  const versions = new Map<number, number>();
  const windows = new Map<number, readonly MessagePayload[]>();
  const subscribed = new Set<string | null>();
  const offs = new Map<string | null, () => void>();
  let loading = false;
  let failed = false;
  let activeCursor: string | null = null;
  let attempt = 0;
  let sequence = 0;
  let stopped = false;
  let nextCursor: string | null = null;
  const subscribe = (cursor: string | null) => {
    if (stopped || subscribed.has(cursor)) return;
    const index = subscribed.size;
    subscribed.add(cursor);
    activeCursor = cursor;
    loading = true;
    failed = false;
    onStatus({ loading, error: failed });
    const currentAttempt = ++attempt;
    versions.set(index, currentAttempt);
    const off = runtime.watchThread(
      rootId,
      (incoming) => {
        if (stopped || versions.get(index) !== currentAttempt) return;
        windows.set(index, incoming);
        const combined = [
          ...new Map(
            [...windows.entries()]
              .sort(([a], [b]) => a - b)
              .flatMap(([, rows]) => rows)
              .map((row) => [row.id, row]),
          ).values(),
        ];
        const snapshot = ++sequence;
        void runtime.session.receiveMessages(combined, `thread:${rootId}`).then(() => {
          if (!stopped && snapshot === sequence) onChange(combined);
        });
      },
      {
        cursor,
        onPage: (next) => {
          if (stopped || index !== subscribed.size - 1) return;
          if (currentAttempt !== attempt) return;
          loading = false;
          failed = false;
          onStatus({ loading, error: failed });
          nextCursor = next;
          onPage(next);
        },
        onError: () => {
          if (stopped || currentAttempt !== attempt) return;
          loading = false;
          failed = true;
          onStatus({ loading, error: failed });
        },
      },
    );
    offs.set(cursor, off);
  };
  subscribe(null);
  return {
    loadMore: () => {
      if (loading || stopped) return;
      if (failed) {
        offs.get(activeCursor)?.();
        offs.delete(activeCursor);
        subscribed.delete(activeCursor);
        subscribe(activeCursor);
      } else if (nextCursor !== null) {
        subscribe(nextCursor);
      }
    },
    stop: () => {
      stopped = true;
      for (const off of offs.values()) off();
    },
  };
}
