import { useRef } from "react";

/**
 * The last defined value wins until a new defined one arrives. A Convex query
 * normally keeps its cached result across a reconnect; a rebuilt client reports
 * `undefined` again, and a loading gate must not unmount the view it guards.
 */
export function keepLastDefined<T>(previous: T | undefined, next: T | undefined): T | undefined {
  return next ?? previous;
}

/** React form of {@link keepLastDefined}. */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(value);
  if (value !== undefined) {
    last.current = value;
  }
  return keepLastDefined(last.current, value);
}
