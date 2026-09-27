/**
 * Per-device composer drafts, keyed by channel. Drafts are text the person
 * typed on this device, so they live in this browser's storage only and never
 * go to the server.
 */
const PREFIX = "aulora.draft.v1:";

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
