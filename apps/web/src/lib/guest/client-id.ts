import { createVoiceClientId, isVoiceClientId } from "@aulora/core";

const KEY = "aulora.guestClient.v1";

/**
 * A random id for this browser, sent with the join request only so a guest who
 * was removed cannot immediately ask again through the same link. It carries
 * no identity; clearing site data makes a new one.
 */
export function guestClientId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing !== null && isVoiceClientId(existing)) {
      return existing;
    }
    const created = createVoiceClientId();
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    return createVoiceClientId();
  }
}
