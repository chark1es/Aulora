import {
  type MediaDeviceInfo as AuloraMediaDevice,
  resolutionConstraints,
  type VoiceDeviceSettings,
} from "@aulora/core";

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
}

/** The microphone constraint set derived from the user's device preferences. */
function audioConstraints(settings: VoiceDeviceSettings): MediaTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
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
    audio: audioConstraints(options.settings),
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

export interface DisplayCaptureOptions {
  readonly settings: VoiceDeviceSettings;
}

/**
 * Requests a screen/window/tab capture. `contentHint = "text"` biases the
 * encoder toward sharp text for presentations; `"detail"` keeps motion crisp.
 * These hints are what keep shared screens readable at low bitrate.
 */
export async function acquireDisplay(options: DisplayCaptureOptions): Promise<MediaStreamTrack> {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    throw new Error("This device cannot share its screen");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: true,
  });
  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    throw new Error("No screen track was produced");
  }
  applyContentHint(track, options.settings.screenCodec);
  return track;
}

function applyContentHint(track: MediaStreamTrack, codec: VoiceDeviceSettings["screenCodec"]) {
  // `detail` reads as "preserve fidelity": best default for slides and code.
  const hint = codec === "auto" ? "detail" : "text";
  try {
    track.contentHint = hint;
  } catch {
    // Older browsers reject unknown hints; the track still works.
  }
}

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
  let frame = 0;
  const tick = () => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const value of data) {
      sum += value * value;
    }
    const rms = Math.sqrt(sum / data.length) / 255;
    const next = rms > smoothed ? rms : smoothed * 0.85;
    smoothed = next;
    onLevel(Math.min(1, next * 3));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
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
