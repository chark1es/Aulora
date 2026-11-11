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
