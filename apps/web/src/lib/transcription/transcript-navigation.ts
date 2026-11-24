/**
 * A tiny external store that carries "open this transcript" from anywhere in
 * the app (the in-call toast, the live panel) to the Transcripts surface.
 *
 * The chat shell owns which main view is showing and the Transcripts surface is
 * lazy and kept alive, so neither can be called directly. Instead the request
 * is parked here: the shell subscribes and switches views, and the Transcripts
 * surface reads it on mount or on change, selects the session and consumes it.
 */

let pending: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Asks the app to show the Transcripts surface with this session open. */
export function requestOpenTranscript(sessionId: string): void {
  if (pending === sessionId) {
    return;
  }
  pending = sessionId;
  emit();
}

export function subscribeTranscriptNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session waiting to be opened, or null. */
export function getTranscriptNavigationSnapshot(): string | null {
  return pending;
}

/** Clears the request. With an id, only when it is still that request. */
export function consumeTranscriptRequest(sessionId?: string): void {
  if (pending === null || (sessionId !== undefined && pending !== sessionId)) {
    return;
  }
  pending = null;
  emit();
}
