/**
 * A tiny app-wide signal for "the session may have changed".
 *
 * Native OAuth can finish in a browser and hand the token back through a deep
 * link. That route has no access to the mounted auth client's session atom, so
 * it nudges the signed-in gate to refetch after it has persisted the token.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
const errorListeners = new Set<Listener>();

/** Asks the mounted session gates to check the session again. */
export function notifyAuthChanged(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Subscribes to {@link notifyAuthChanged}; returns an unsubscribe function. */
export function subscribeAuthChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Tells a mounted sign-in screen that the callback route stored an error while
 * the screen was already open. The route cannot reach the screen's state.
 */
export function notifyAuthError(): void {
  for (const listener of [...errorListeners]) {
    listener();
  }
}

/** Subscribes to {@link notifyAuthError}; returns an unsubscribe function. */
export function subscribeAuthError(listener: Listener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}
