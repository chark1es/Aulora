/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { PipMediaKind } from "../call-pip";
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

/** The single video track the shell's call window should receive. */
export interface PipVideoSource {
  readonly track: MediaStreamTrack | null;
  readonly kind: PipMediaKind;
  /** The name drawn over the picture; empty when there is no picture. */
  readonly label: string;
  readonly muted: boolean;
}

/**
 * Chooses the one video track the desktop call window shows, using the same
 * priority as `pickPipSource`: a shared screen, else the speaker, else the
 * first other person, and finally the caller's own picture when nobody else
 * has one (a screen share or camera with no one to watch). Only video is ever
 * returned: the call's audio stays in the main window, never in the window
 * that floats.
 */
export function pickPipVideoSource(
  snapshot: Pick<
    VoiceSnapshot,
    "call" | "remoteStreams" | "remoteScreens" | "remoteSpeaking" | "localVideoTrack" | "local"
  >,
  selfUserId: string,
  nameOf: (userId: string) => string,
): PipVideoSource {
  const others = (snapshot.call?.participants ?? []).filter((entry) => entry.userId !== selfUserId);
  const sharer = others.find((entry) => entry.sharingScreen);
  const speaker = others.find((entry) => snapshot.remoteSpeaking.has(entry.userId));
  const target = sharer ?? speaker ?? others[0];
  if (target !== undefined) {
    const relayed = target.sharingScreen ? snapshot.remoteScreens.get(target.userId) : undefined;
    const stream = relayed ?? snapshot.remoteStreams.get(target.userId);
    const track = stream?.getVideoTracks()[0] ?? null;
    if (track !== null) {
      return {
        track,
        kind: target.sharingScreen ? "screen" : "camera",
        label: nameOf(target.userId),
        muted: target.muted,
      };
    }
  }
  const local = snapshot.localVideoTrack ?? null;
  if (local !== null && local.readyState !== "ended") {
    // The local tile is already the screen while sharing, else the camera.
    return {
      track: local,
      kind: snapshot.local.sharingScreen ? "screen" : "local",
      label: nameOf(selfUserId),
      muted: false,
    };
  }
  return {
    track: null,
    kind: "none",
    label: target === undefined ? "" : nameOf(target.userId),
    muted: target?.muted ?? false,
  };
}
