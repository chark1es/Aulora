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
  autoGainControl: true,
  inputVolume: 1,
  outputVolume: 1,
  mirrorCamera: true,
  videoResolution: "720p",
  pushToTalk: false,
  noiseGateThreshold: 0.08,
  screenCodec: "auto",
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

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Coerces arbitrary stored/partial data onto a complete, valid settings object. */
export function mergeVoiceSettings(
  partial: Partial<VoiceDeviceSettings> | null | undefined,
): VoiceDeviceSettings {
  const p = partial ?? {};
  return {
    inputDeviceId: stringOrNull(p.inputDeviceId, DEFAULT_VOICE_SETTINGS.inputDeviceId),
    outputDeviceId: stringOrNull(p.outputDeviceId, DEFAULT_VOICE_SETTINGS.outputDeviceId),
    cameraDeviceId: stringOrNull(p.cameraDeviceId, DEFAULT_VOICE_SETTINGS.cameraDeviceId),
    echoCancellation: bool(p.echoCancellation, DEFAULT_VOICE_SETTINGS.echoCancellation),
    noiseSuppression: bool(p.noiseSuppression, DEFAULT_VOICE_SETTINGS.noiseSuppression),
    autoGainControl: bool(p.autoGainControl, DEFAULT_VOICE_SETTINGS.autoGainControl),
    inputVolume: clamp(p.inputVolume, 0, 2, DEFAULT_VOICE_SETTINGS.inputVolume),
    outputVolume: clamp(p.outputVolume, 0, 2, DEFAULT_VOICE_SETTINGS.outputVolume),
    mirrorCamera: bool(p.mirrorCamera, DEFAULT_VOICE_SETTINGS.mirrorCamera),
    videoResolution: oneOf(
      p.videoResolution,
      ["360p", "720p", "1080p"] as const,
      DEFAULT_VOICE_SETTINGS.videoResolution,
    ),
    pushToTalk: bool(p.pushToTalk, DEFAULT_VOICE_SETTINGS.pushToTalk),
    noiseGateThreshold: clamp(
      p.noiseGateThreshold,
      0,
      1,
      DEFAULT_VOICE_SETTINGS.noiseGateThreshold,
    ),
    screenCodec: oneOf(
      p.screenCodec,
      ["auto", "av1", "vp9", "h264"] as const,
      DEFAULT_VOICE_SETTINGS.screenCodec,
    ),
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
