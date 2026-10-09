import type { StorageLike } from "../profiles";
import type { VoiceDeviceSettings } from "./types";

/**
 * Device and audio preferences for voice/video calls. Stored device-locally
 * (they contain a device id, never a token) and applied to every call.
 */
export const VOICE_SETTINGS_KEY = "aulora.voiceSettings.v1";

export const DEFAULT_VOICE_SETTINGS: VoiceDeviceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  cameraDeviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  enhancedNoiseSuppression: false,
  autoGainControl: true,
  inputVolume: 1,
  outputVolume: 1,
  mirrorCamera: true,
  videoResolution: "720p",
  pushToTalk: false,
  noiseGateThreshold: 0.08,
  screenCodec: "auto",
  streamQuality: "smooth",
  streamAudio: true,
  backgroundEffect: "none",
  backgroundBlur: "strong",
  backgroundImage: "dusk",
  joinMuted: false,
  joinWithCamera: true,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const BACKDROP_ID = /^[a-z][a-z0-9-]{0,31}$/;

function backdropId(value: unknown, fallback: string): string {
  return typeof value === "string" && BACKDROP_ID.test(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

type Stored = Partial<VoiceDeviceSettings>;

/** Capture constraints and levels for the microphone. */
function mergeAudio(p: Stored) {
  return {
    inputDeviceId: stringOrNull(p.inputDeviceId, DEFAULT_VOICE_SETTINGS.inputDeviceId),
    outputDeviceId: stringOrNull(p.outputDeviceId, DEFAULT_VOICE_SETTINGS.outputDeviceId),
    echoCancellation: bool(p.echoCancellation, DEFAULT_VOICE_SETTINGS.echoCancellation),
    noiseSuppression: bool(p.noiseSuppression, DEFAULT_VOICE_SETTINGS.noiseSuppression),
    enhancedNoiseSuppression: bool(
      p.enhancedNoiseSuppression,
      DEFAULT_VOICE_SETTINGS.enhancedNoiseSuppression,
    ),
    autoGainControl: bool(p.autoGainControl, DEFAULT_VOICE_SETTINGS.autoGainControl),
    inputVolume: clamp(p.inputVolume, 0, 2, DEFAULT_VOICE_SETTINGS.inputVolume),
    outputVolume: clamp(p.outputVolume, 0, 2, DEFAULT_VOICE_SETTINGS.outputVolume),
    pushToTalk: bool(p.pushToTalk, DEFAULT_VOICE_SETTINGS.pushToTalk),
    noiseGateThreshold: clamp(
      p.noiseGateThreshold,
      0,
      1,
      DEFAULT_VOICE_SETTINGS.noiseGateThreshold,
    ),
  };
}

/** The camera, and what is drawn behind the person on it. */
function mergeVideo(p: Stored) {
  return {
    cameraDeviceId: stringOrNull(p.cameraDeviceId, DEFAULT_VOICE_SETTINGS.cameraDeviceId),
    mirrorCamera: bool(p.mirrorCamera, DEFAULT_VOICE_SETTINGS.mirrorCamera),
    videoResolution: oneOf(
      p.videoResolution,
      ["360p", "720p", "1080p"] as const,
      DEFAULT_VOICE_SETTINGS.videoResolution,
    ),
    backgroundEffect: oneOf(
      p.backgroundEffect,
      ["none", "blur", "image"] as const,
      DEFAULT_VOICE_SETTINGS.backgroundEffect,
    ),
    backgroundBlur: oneOf(
      p.backgroundBlur,
      ["light", "strong"] as const,
      DEFAULT_VOICE_SETTINGS.backgroundBlur,
    ),
    backgroundImage: backdropId(p.backgroundImage, DEFAULT_VOICE_SETTINGS.backgroundImage),
  };
}

/** Screen and window sharing. */
function mergeSharing(p: Stored) {
  return {
    screenCodec: oneOf(
      p.screenCodec,
      ["auto", "av1", "vp9", "h264"] as const,
      DEFAULT_VOICE_SETTINGS.screenCodec,
    ),
    streamQuality: oneOf(
      p.streamQuality,
      ["smooth", "balanced", "saver"] as const,
      DEFAULT_VOICE_SETTINGS.streamQuality,
    ),
    streamAudio: bool(p.streamAudio, DEFAULT_VOICE_SETTINGS.streamAudio),
  };
}

/** Coerces arbitrary stored/partial data onto a complete, valid settings object. */
export function mergeVoiceSettings(
  partial: Partial<VoiceDeviceSettings> | null | undefined,
): VoiceDeviceSettings {
  const p = partial ?? {};
  return {
    ...mergeAudio(p),
    ...mergeVideo(p),
    ...mergeSharing(p),
    joinMuted: bool(p.joinMuted, DEFAULT_VOICE_SETTINGS.joinMuted),
    joinWithCamera: bool(p.joinWithCamera, DEFAULT_VOICE_SETTINGS.joinWithCamera),
  };
}

/** Reads device settings, falling back to defaults for missing/corrupt data. */
export function loadVoiceSettings(store: StorageLike): VoiceDeviceSettings {
  try {
    const raw = store.getItem(VOICE_SETTINGS_KEY);
    if (raw === null || raw.length === 0) {
      return DEFAULT_VOICE_SETTINGS;
    }
    return mergeVoiceSettings(JSON.parse(raw) as Partial<VoiceDeviceSettings>);
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

/** Persists device settings; best-effort so a blocked storage never breaks a call. */
export function saveVoiceSettings(store: StorageLike, settings: VoiceDeviceSettings): void {
  try {
    store.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage is best-effort.
  }
}

/** In-memory store used when no persistent store is available (native/tests). */
export function memoryVoiceSettingsStore(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Target capture constraints for the selected camera resolution. */
export function resolutionConstraints(resolution: VoiceDeviceSettings["videoResolution"]): {
  width: number;
  height: number;
  frameRate: number;
} {
  switch (resolution) {
    case "360p":
      return { width: 640, height: 360, frameRate: 24 };
    case "1080p":
      return { width: 1920, height: 1080, frameRate: 30 };
    default:
      return { width: 1280, height: 720, frameRate: 30 };
  }
}

/**
 * What a screen or window stream asks of capture and the encoder. The sizes are
 * ceilings: the browser scales down to whatever the captured surface offers.
 * Tuned for desktops and applications, so text stays sharp and frame rate is
 * spent where it helps (scrolling, video playback) rather than on game motion.
 */
export interface StreamProfile {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** Peak video bitrate in bits per second for one viewer connection. */
  readonly maxBitrate: number;
}

export function streamProfile(quality: VoiceDeviceSettings["streamQuality"]): StreamProfile {
  switch (quality) {
    case "saver":
      return { width: 1280, height: 720, frameRate: 15, maxBitrate: 1_200_000 };
    case "balanced":
      return { width: 1920, height: 1080, frameRate: 15, maxBitrate: 2_200_000 };
    default:
      return { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_500_000 };
  }
}
