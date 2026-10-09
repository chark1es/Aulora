/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { VoiceSnapshot } from "./call-types";

/** What the video-element picture-in-picture shows: one participant's picture and name. */
export interface PipSource {
  readonly stream: MediaStream | null;
  readonly label: string;
  readonly muted: boolean;
}

/**
 * Chooses who the picture-in-picture shows: whoever is sharing their screen,
 * else whoever is talking, else the first other person, else the caller.
 */
export function pickPipSource(
  snapshot: Pick<VoiceSnapshot, "call" | "remoteStreams" | "remoteScreens" | "remoteSpeaking">,
  selfUserId: string,
  nameOf: (userId: string) => string,
): PipSource {
  const others = (snapshot.call?.participants ?? []).filter((entry) => entry.userId !== selfUserId);
  const sharer = others.find((entry) => entry.sharingScreen);
  const speaker = others.find((entry) => snapshot.remoteSpeaking.has(entry.userId));
  const target = sharer ?? speaker ?? others[0];
  if (target === undefined) {
    return { stream: null, label: "Waiting for others", muted: false };
  }
  const relayed = target.sharingScreen ? snapshot.remoteScreens.get(target.userId) : undefined;
  const candidate = relayed ?? snapshot.remoteStreams.get(target.userId) ?? null;
  const hasPicture = candidate !== null && candidate.getVideoTracks().length > 0;
  return {
    stream: hasPicture ? candidate : null,
    label: nameOf(target.userId),
    muted: target.muted,
  };
}
