import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "aulora:live-transcript-open";

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function write(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

let open = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the viewer wants the live transcript panel open. Shared by the inline
 * call view and the expanded stage so both agree, and remembered per browser.
 */
export function useLiveTranscriptOpen(): readonly [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
  const set = useCallback((next: boolean) => {
    if (open === next) {
      return;
    }
    open = next;
    write(next);
    for (const listener of [...listeners]) {
      listener();
    }
  }, []);
  return [value, set];
}

/** Test hook: re-reads the stored preference. */
export function resetLiveTranscriptOpenForTests(): void {
  open = read();
  for (const listener of [...listeners]) {
    listener();
  }
}
