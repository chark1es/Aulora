import { type StreamFrameRate, streamProfile, type VoiceDeviceSettings } from "@aulora/core";
import { isDesktop } from "../desktop";
import { messageOf } from "./call-errors";
import { openDisplayStream } from "./desktop-display";
import { requestDisplaySource } from "./display-picker";
import { openSystemAudioStream, type SystemAudioCapture } from "./system-audio";

/**
 * Screen, window and tab capture for a stream.
 *
 * Tuned for sharing a desktop or an application rather than a game: the video
 * is hinted `detail` so the encoder keeps text and UI edges sharp and trades
 * frame rate first, and the audio (when the platform offers any) is captured
 * untouched so music and video playback are not run through voice processing.
 *
 * The browser build asks the engine for a surface through `getDisplayMedia`.
 * The desktop shell cannot theme that picker, so it lists the sources itself and
 * Aulora draws the dialog (see `display-picker.ts`). Its audio comes from the
 * shell's own capture (see `system-audio.ts`) rather than from the picked
 * surface, and when that backend is unavailable the share carries on without it.
 */
export interface DisplayCapture {
  readonly video: MediaStreamTrack;
  /** The captured surface's own audio; `null` when the platform or choice has none. */
  readonly audio: MediaStreamTrack | null;
  /**
   * A non-blocking explanation of a degraded share, e.g. the system audio
   * backend failed and only video is being sent. `null` when all is well.
   */
  readonly notice?: string | null;
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
  const profile = streamProfile(settings.streamResolution, settings.streamFrameRate);
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

/**
 * What the encoder should optimize for. At 30 fps and above the share is
 * treated as motion (video, games, scrolling), so a `motion` hint spends bits on
 * movement. At 15 fps the person chose sharp text over smoothness, so the hint
 * is `detail`: UI edges stay crisp and the encoder trades frame rate first.
 */
export function displayContentHint(frameRate: StreamFrameRate): "detail" | "motion" {
  return frameRate >= 30 ? "motion" : "detail";
}

/**
 * What the sender gives up when the CPU or the link is short. At 30 fps and
 * above it uses `balanced`: WebRTC then lowers the resolution before the frame
 * rate, instead of freezing to a slideshow. At 15 fps the share is for sharp
 * text, so it holds the resolution.
 */
export function displayDegradation(frameRate: StreamFrameRate): "balanced" | "maintain-resolution" {
  return frameRate >= 30 ? "balanced" : "maintain-resolution";
}

/**
 * Whether the shell provides its own capture sources. When it does, Aulora
 * draws the picker and no engine picker (`tauri.localhost wants to share your
 * screen`) is shown.
 */
export function desktopPickerAvailable(): boolean {
  return isDesktop();
}

/**
 * The shell's own capture path: pick a source in Aulora's dialog, pull its frames
 * through the canvas stream, and take the machine's audio from the shell when
 * the person kept the toggle on.
 *
 * A failing audio backend never fails the share: the video keeps flowing and the
 * reason travels back as {@link DisplayCapture.notice}.
 */
async function acquireDesktopDisplay(settings: VoiceDeviceSettings): Promise<DisplayCapture> {
  const profile = streamProfile(settings.streamResolution, settings.streamFrameRate);
  const choice = await requestDisplaySource({ audioRequested: settings.streamAudio });
  const stream = await openDisplayStream(choice.source, profile);
  hint(stream.track, displayContentHint(settings.streamFrameRate));

  let audio: SystemAudioCapture | null = null;
  let notice: string | null = null;
  if (choice.audioRequested) {
    try {
      audio = await openSystemAudioStream(choice.source.id);
    } catch (error) {
      notice = `Sharing without system audio: ${messageOf(error)}`;
    }
  }

  return {
    video: stream.track,
    audio: audio?.track ?? null,
    notice,
    stop() {
      audio?.stop();
      stream.stop();
    },
  };
}

/** Asks the user to pick a screen, window or tab and returns the captured tracks. */
export async function acquireDisplay(settings: VoiceDeviceSettings): Promise<DisplayCapture> {
  if (desktopPickerAvailable()) {
    return acquireDesktopDisplay(settings);
  }
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
  hint(video, displayContentHint(settings.streamFrameRate));
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
