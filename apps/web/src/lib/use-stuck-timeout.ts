import { createStuckTimeout, STUCK_TIMEOUT_MS } from "@aulora/core";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

export { createStuckTimeout, STUCK_TIMEOUT_MS } from "@aulora/core";

type Listener = () => void;

/**
 * Reports whether `waiting` has lasted longer than `timeoutMs`. Pass a changed
 * `resetSignal` (e.g. a retry counter) to restart the countdown after a retry.
 */
export function useStuckTimeout(
  waiting: boolean,
  resetSignal = 0,
  timeoutMs: number = STUCK_TIMEOUT_MS,
): boolean {
  const store = useMemo(() => createStuckTimeout(timeoutMs), [timeoutMs]);
  const subscribe = useCallback((listener: Listener) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.isStuck(), [store]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed reset signal restarts the countdown even while the same wait continues
  useEffect(() => {
    if (waiting) {
      store.start();
    } else {
      store.stop();
    }
    return () => {
      store.stop();
    };
  }, [store, waiting, resetSignal]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
