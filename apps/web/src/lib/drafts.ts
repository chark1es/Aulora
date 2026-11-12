import { createContext } from "react";
import { storageScope } from "./storage-scope";

/** Unscoped callers keep drafts in memory only. Legacy keys are never read. */
export const DraftScopeContext = createContext<string | undefined>(undefined);
export function draftScope(serverUrl: string, userId: string): string {
  return storageScope(serverUrl, userId);
}
export function scopedDraftKey(
  scope: string | undefined,
  key: string | undefined,
): string | undefined {
  return scope === undefined || key === undefined ? undefined : `${scope}:${key}`;
}

/**
 * Per-device composer drafts, keyed by channel. Drafts are text the person
 * typed on this device, so they live in this browser's storage only and never
 * go to the server.
 */
const PREFIX = "aulora.draft.v2:";

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): DraftStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: DraftStorage }).localStorage;
    return candidate !== undefined && typeof candidate.getItem === "function" ? candidate : null;
  } catch {
    return null;
  }
}

export function readDraft(channelId: string, store: DraftStorage | null = storage()): string {
  try {
    return store?.getItem(`${PREFIX}${channelId}`) ?? "";
  } catch {
    return "";
  }
}

/** Saves a draft; an empty or whitespace-only draft is removed. */
export function writeDraft(
  channelId: string,
  text: string,
  store: DraftStorage | null = storage(),
): void {
  try {
    if (text.trim().length === 0) {
      store?.removeItem(`${PREFIX}${channelId}`);
    } else {
      store?.setItem(`${PREFIX}${channelId}`, text);
    }
  } catch {
    // Storage full or unavailable (private mode): the draft stays in memory only.
  }
}

const submissionListeners = new Map<string, Set<(snapshot: string) => void>>();

/** Notify remounted composers when an earlier instance finishes sending. */
export function submitDraft(key: string, snapshot: string): void {
  if (readDraft(key) === snapshot) writeDraft(key, "");
  for (const listener of submissionListeners.get(key) ?? []) listener(snapshot);
}

export function watchDraftSubmissions(
  key: string,
  listener: (snapshot: string) => void,
): () => void {
  const listeners = submissionListeners.get(key) ?? new Set();
  submissionListeners.set(key, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) submissionListeners.delete(key);
  };
}
