/**
 * A tiny app-wide signal for "the session may have changed".
 *
 * A native OAuth finish can hand the desktop shell a token through a deep link
 * while the app is already running. The deep-link handler has no access to the
 * mounted auth client's session atom, so it nudges the session gate to refetch
 * instead of reloading the whole page (which used to reset the open channel,
 * panels and a call).
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
 * Tells a mounted sign-in form that a callback error was stored while it was
 * already open. The deep-link handler cannot reach the form's state directly.
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
