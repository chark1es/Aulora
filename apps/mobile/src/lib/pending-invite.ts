/**
 * An invite code from a deep link (`aulora://invite/<code>`) waiting for the
 * person to finish signing in. Kept in memory: the link is opened on demand, so
 * there is nothing to restore after a cold start beyond opening it again.
 *
 * A code is captured against the account signed in when the link arrived. An
 * unauthenticated capture stays unclaimed so it survives the sign-in flow; a
 * captured code is dropped when the account changes, so one person never
 * inherits an invite meant for another.
 */
type Listener = () => void;

interface PendingInvite {
  readonly code: string;
  /** The account the link arrived for, or null while still unclaimed. */
  readonly owner: string | null;
}

let pending: PendingInvite | null = null;
let currentIdentity: string | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function replace(next: PendingInvite | null): void {
  if (next?.code === pending?.code && next?.owner === pending?.owner) {
    return;
  }
  pending = next;
  emit();
}

/** Records the code from a deep link, owned by whoever is signed in now. */
export function setPendingInvite(code: string | null): void {
  const trimmed = code !== null && code.trim().length > 0 ? code.trim() : null;
  replace(trimmed === null ? null : { code: trimmed, owner: currentIdentity });
}

/** Clears a pending invite, e.g. once it is redeemed. */
export function clearPendingInvite(): void {
  replace(null);
}

/**
 * Ties a waiting code to the signed-in account. Called whenever the session
 * identity changes: an unclaimed code is adopted by the account that appears,
 * and a code owned by a different account is discarded.
 */
export function bindPendingInvite(identity: string | null): void {
  currentIdentity = identity;
  if (pending === null) {
    return;
  }
  if (pending.owner === null) {
    if (identity !== null) {
      replace({ code: pending.code, owner: identity });
    }
    return;
  }
  if (pending.owner !== identity) {
    replace(null);
  }
}

export function getPendingInvite(): string | null {
  return pending?.code ?? null;
}

export function subscribePendingInvite(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
