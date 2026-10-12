/**
 * An invite code from a deep link (`aulora://invite/<code>`) waiting for the
 * person to finish signing in. Kept in memory: the link is opened on demand, so
 * there is nothing to restore after a cold start beyond opening it again.
 */
type Listener = () => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

export function setPendingInvite(code: string | null): void {
  const next = code !== null && code.trim().length > 0 ? code.trim() : null;
  if (next === pending) {
    return;
  }
  pending = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getPendingInvite(): string | null {
  return pending;
}

export function subscribePendingInvite(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
