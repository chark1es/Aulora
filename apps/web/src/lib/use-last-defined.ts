import { useRef } from "react";

/**
 * Returns the latest defined value of `value`.
 *
 * A Convex query normally keeps its cached result across a reconnect, but a
 * rebuilt client (or a query that is briefly unavailable) reports `undefined`
 * again. Loading gates that switch on `undefined` would then unmount the view
 * they guard — losing the open channel, panels, a call and the reader's place.
 * Keeping the last known value across that gap means a gate only waits when it
 * has never had an answer.
 */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(value);
  if (value !== undefined) {
    last.current = value;
  }
  return value ?? last.current;
}
