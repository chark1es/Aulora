import { streamProfile, type VoiceDeviceSettings } from "@aulora/core";

/**
 * Screen, window and tab capture for a stream.
 *
 * Tuned for sharing a desktop or an application rather than a game: the video
 * is hinted `detail` so the encoder keeps text and UI edges sharp and trades
 * frame rate first, and the audio (when the platform offers any) is captured
 * untouched so music and video playback are not run through voice processing.
 */
export interface DisplayCapture {
  readonly video: MediaStreamTrack;
  /** The captured surface's own audio; `null` when the platform or choice has none. */
  readonly audio: MediaStreamTrack | null;
  /** Stops every track. Safe to call more than once. */
  stop(): void;
}

interface DisplayAudioConstraints extends MediaTrackConstraints {
  suppressLocalAudioPlayback?: boolean;
}

/** Chromium extensions to `getDisplayMedia`; browsers ignore the ones they lack. */
interface ExtendedDisplayOptions extends Omit<DisplayMediaStreamOptions, "audio"> {
  audio?: boolean | DisplayAudioConstraints;
  systemAudio?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
}

function captureOptions(settings: VoiceDeviceSettings): ExtendedDisplayOptions {
  const profile = streamProfile(settings.streamQuality);
  return {
    video: {
      width: { max: profile.width },
      height: { max: profile.height },
      frameRate: { ideal: profile.frameRate, max: profile.frameRate },
    },
    audio: settings.streamAudio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Keep the call's own playback out of the share, or viewers hear
          // everyone (and themselves) echoed back.
          suppressLocalAudioPlayback: true,
        }
      : false,
    systemAudio: settings.streamAudio ? "include" : "exclude",
    // Let the sharer switch the shared window without ending the stream.
    surfaceSwitching: "include",
    // Sharing this very tab shows the call inside the call.
    selfBrowserSurface: "exclude",
    monitorTypeSurfaces: "include",
  };
}

function hint(track: MediaStreamTrack, value: string): void {
  try {
    (track as MediaStreamTrack & { contentHint: string }).contentHint = value;
  } catch {
    // Older browsers reject unknown hints; the track still works.
  }
}

/** Asks the user to pick a screen, window or tab and returns the captured tracks. */
export async function acquireDisplay(settings: VoiceDeviceSettings): Promise<DisplayCapture> {
  const devices =
    typeof navigator === "undefined"
      ? undefined
      : (navigator.mediaDevices as Partial<MediaDevices> | undefined);
  if (devices?.getDisplayMedia === undefined) {
    throw new Error("This device cannot share its screen");
  }
  const stream = await devices.getDisplayMedia(captureOptions(settings));
  const video = stream.getVideoTracks()[0];
  if (video === undefined) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    throw new Error("No screen track was produced");
  }
  const audio = stream.getAudioTracks()[0] ?? null;
  hint(video, "detail");
  if (audio !== null) {
    hint(audio, "music");
  }
  return {
    video,
    audio,
    stop() {
      video.stop();
      audio?.stop();
    },
  };
}
