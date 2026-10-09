import { createVoiceClientId, ensureVoiceClientId } from "@aulora/core";

/** A relayed share's own audio plays beside the call audio, under its own key. */
export function withScreenAudio(
  streams: ReadonlyMap<string, MediaStream>,
  screens: ReadonlyMap<string, MediaStream>,
): ReadonlyMap<string, MediaStream> {
  if (screens.size === 0) {
    return streams;
  }
  const combined = new Map(streams);
  for (const [userId, stream] of screens) {
    if (stream.getAudioTracks().length > 0) {
      combined.set(`screen:${userId}`, stream);
    }
  }
  return combined;
}

export function loadBrowserVoiceClientId(): string {
  try {
    if (typeof localStorage !== "undefined") {
      return ensureVoiceClientId(localStorage);
    }
  } catch {
    // Private mode can throw on access. A session-only id still separates tabs
    // that do not share storage, which is enough to keep seats apart.
  }
  return createVoiceClientId();
}
