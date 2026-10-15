/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type MediaDeviceInfo as AuloraMediaDevice,
  resolutionConstraints,
  type VoiceDeviceSettings,
} from "@aulora/core";
import { audioContextCtor } from "./audio-context";

/**
 * Thin, well-typed wrappers over the browser media APIs, kept free of React so
 * the call engine and the device-settings UI can share them.
 */

/** Enumerates input/output devices. Labels are only populated once permission is granted. */
export async function listMediaDevices(): Promise<AuloraMediaDevice[]> {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const kindOf = (kind: MediaDeviceKind): AuloraMediaDevice["kind"] | null => {
    if (kind === "audioinput") {
      return "audioinput";
    }
    if (kind === "audiooutput") {
      return "audiooutput";
    }
    if (kind === "videoinput") {
      return "videoinput";
    }
    return null;
  };
  const result: AuloraMediaDevice[] = [];
  for (const device of devices) {
    const kind = kindOf(device.kind);
    if (kind === null) {
      continue;
    }
    result.push({
      deviceId: device.deviceId,
      kind,
      label:
        device.label.length > 0
          ? device.label
          : defaultLabel(kind, result.filter((entry) => entry.kind === kind).length + 1),
    });
  }
  return result;
}

function defaultLabel(kind: AuloraMediaDevice["kind"], index: number): string {
  switch (kind) {
    case "audioinput":
      return `Microphone ${index}`;
    case "audiooutput":
      return `Speaker ${index}`;
    case "videoinput":
      return `Camera ${index}`;
  }
}

/** Subscribes to device add/remove. Returns an unsubscribe. */
export function onDeviceChange(listener: () => void): () => void {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    return () => {};
  }
  navigator.mediaDevices.addEventListener("devicechange", listener);
  return () => navigator.mediaDevices.removeEventListener("devicechange", listener);
}

export interface AudioCaptureOptions {
  readonly settings: VoiceDeviceSettings;
  readonly withVideo: boolean;
  /**
   * The learned denoiser will process this microphone, so the browser's own
   * suppression is switched off to avoid distorting the voice twice.
   */
  readonly enhanced?: boolean;
}

/** The microphone constraint set derived from the user's device preferences. */
function audioConstraints(settings: VoiceDeviceSettings, enhanced: boolean): MediaTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression && !enhanced,
    autoGainControl: settings.autoGainControl,
    ...(settings.inputDeviceId !== null ? { deviceId: { exact: settings.inputDeviceId } } : {}),
  };
}

function videoConstraints(settings: VoiceDeviceSettings): MediaTrackConstraints {
  const target = resolutionConstraints(settings.videoResolution);
  return {
    ...target,
    ...(settings.cameraDeviceId !== null ? { deviceId: { exact: settings.cameraDeviceId } } : {}),
  };
}

/** Requests the microphone (and camera when `withVideo`) with the stored settings. */
export async function acquireUserMedia(options: AudioCaptureOptions): Promise<MediaStream> {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    throw new Error("This device does not support media capture");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraints(options.settings, options.enhanced === true),
    video: options.withVideo ? videoConstraints(options.settings) : false,
  });
}

/** Requests a camera track with the stored settings, closing a prior stream. */
export async function acquireVideo(settings: VoiceDeviceSettings): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints(settings),
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    throw new Error("No camera track was produced");
  }
  return track;
}

/** A WebAudio playback path for one remote stream, used to boost past unity. */
export interface OutputGain {
  setVolume(volume: number): void;
  stop(): void;
}

export function createOutputGain(stream: MediaStream, volume: number): OutputGain | null {
  const Ctor = audioContextCtor();
  if (Ctor === null) {
    return null;
  }
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(context.destination);
  void context.resume().catch(() => undefined);
  return {
    setVolume(next) {
      gain.gain.setTargetAtTime(next, context.currentTime, 0.02);
    },
    stop() {
      source.disconnect();
      gain.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}

const METER_INTERVAL_MS = 33;
/** Per-tick fall-off, chosen so the level decays at the same rate as the old 60 Hz loop. */
const METER_DECAY = 0.72;

/** Live microphone level, 0..1, with a fast attack and a slow decay. */
export function createLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  if (typeof AudioContext === "undefined") {
    return () => {};
  }
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let smoothed = 0;
  void context.resume().catch(() => undefined);
  const tick = () => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const value of data) {
      sum += value * value;
    }
    const rms = Math.sqrt(sum / data.length) / 255;
    const next = rms > smoothed ? rms : smoothed * METER_DECAY;
    smoothed = next;
    onLevel(Math.min(1, next * 3));
  };
  // A timer, not `requestAnimationFrame`: browsers stop animation frames in a
  // hidden window, which is exactly when a call is in a PiP window or another tab
  // and the speaking indicator still has to follow the voice.
  const timer = setInterval(tick, METER_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    void context.close().catch(() => undefined);
  };
}

/** Whether the browser can route audio to a chosen output device. */
export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** Routes an audio element to the chosen speaker, ignoring unsupported browsers. */
export async function applySinkId(
  element: HTMLMediaElement,
  deviceId: string | null,
): Promise<void> {
  if (!supportsOutputSelection()) {
    return;
  }
  try {
    await (element as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(
      deviceId ?? "",
    );
  } catch {
    // A device may have vanished; fall back silently to the default output.
  }
}

/** Human label for a device kind, for the settings UI. */
export function deviceKindLabel(kind: AuloraMediaDevice["kind"]): string {
  switch (kind) {
    case "audioinput":
      return "Microphone";
    case "audiooutput":
      return "Speaker";
    case "videoinput":
      return "Camera";
  }
}
