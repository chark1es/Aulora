/**
 * A tiny helper for Convex's local query handles.
 *
 * `watchQuery` delivers the current cached result immediately through
 * `localQueryResult`, then on every change through `onUpdate`. A warm client
 * can deliver before `onUpdate` is attached, so the value is read once up
 * front. The handle is typed structurally so this stays framework-agnostic and
 * unit-testable without Convex.
 */

import type { Fn } from "./function-type";

export interface LocalQueryHandle<T> {
  localQueryResult(): T | undefined;
  readonly onUpdate: Fn<[listener: () => void], () => void>;
}

/** Subscribes to a local query handle, emitting its cached value immediately. */
export function watchLocalQuery<T>(
  handle: LocalQueryHandle<T>,
  onChange: Fn<[value: T], void>,
): () => void {
  const emit = () => {
    const value = handle.localQueryResult();
    if (value !== undefined) {
      onChange(value);
    }
  };
  const unsubscribe = handle.onUpdate(emit);
  emit();
  return () => {
    unsubscribe();
  };
}
