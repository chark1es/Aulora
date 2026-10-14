import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/** How long a server-dependent wait runs before we offer recovery actions. */
export const STUCK_TIMEOUT_MS = 10_000;

type Listener = () => void;

/**
 * A tiny timer with subscribers. Exposed separately from the hook so the
 * countdown can be unit-tested with fake timers, without rendering React.
 */
export interface StuckTimeout {
  isStuck(): boolean;
  /** (Re)starts the countdown; clears a previously reported stuck state. */
  start(): void;
  /** Ends the wait and clears the countdown. */
  stop(): void;
  subscribe(listener: Listener): () => void;
}

export function createStuckTimeout(timeoutMs: number = STUCK_TIMEOUT_MS): StuckTimeout {
  let stuck = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<Listener>();

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  return {
    isStuck: () => stuck,
    start() {
      clear();
      if (stuck) {
        stuck = false;
        emit();
      }
      timer = setTimeout(() => {
        timer = undefined;
        stuck = true;
        emit();
      }, timeoutMs);
    },
    stop() {
      clear();
      if (stuck) {
        stuck = false;
        emit();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

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
