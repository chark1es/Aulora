/**
 * Backoff for rebuilding a connection that will not recover on its own.
 *
 * A Convex client keeps its websocket, its auth token and its reconnect
 * backoff for its whole life, and a Better Auth client keeps the session
 * snapshot and token cache in its store. After the server restarted, both sat
 * on a dead state that retrying in place could not clear, so recovery is a
 * rebuild of both clients. Rebuilding immediately would hammer a server that is
 * still starting, so the first report waits a second and each further report
 * doubles up to {@link RECOVERY_DELAYS_MS}'s last entry. A person who asks
 * explicitly skips the wait.
 */

/** Waits before each rebuild, in order; the last value repeats. */
export const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export interface ConnectionRecovery {
  /**
   * Reports a wait that is stuck: schedules one rebuild, escalating the delay
   * for the next report. Repeated reports while one is pending are ignored, so
   * a poll cannot queue a burst of rebuilds.
   */
  stuck(): void;
  /** Reports a healthy connection: cancels a pending rebuild and the backoff. */
  healthy(): void;
  /** Rebuilds now, for someone who asked first: clears the timer and backoff. */
  retry(): void;
  /** Rebuilds scheduled since the connection was last healthy. */
  attempts(): number;
  dispose(): void;
}

export interface ConnectionRecoveryOptions {
  /** Builds a fresh set of clients; called from a timer or from `retry()`. */
  readonly reset: () => void;
  readonly delays?: readonly number[];
}

export function createConnectionRecovery({
  reset,
  delays = RECOVERY_DELAYS_MS,
}: ConnectionRecoveryOptions): ConnectionRecovery {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function delayFor(attempt: number): number {
    return delays[Math.min(attempt, delays.length - 1)] ?? 0;
  }

  return {
    stuck() {
      if (timer !== undefined) {
        return;
      }
      const delay = delayFor(attempts);
      attempts += 1;
      timer = setTimeout(() => {
        timer = undefined;
        reset();
      }, delay);
    },
    healthy() {
      clear();
      attempts = 0;
    },
    retry() {
      clear();
      attempts = 0;
      reset();
    },
    attempts: () => attempts,
    dispose() {
      clear();
    },
  };
}
