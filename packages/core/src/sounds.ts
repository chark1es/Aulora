import type { StorageLike } from "./profiles";

/**
 * Notification and call sound preferences. Stored device-locally (like voice
 * settings) because volume is a per-device concern, and applied by each client
 * when it plays a cue. The server never stores this.
 */
export const SOUND_SETTINGS_KEY = "aulora.soundSettings.v1";

/** The distinct cues a client can play. */
export type SoundEvent =
  | "message"
  | "mention"
  | "call-ring"
  | "call-connect"
  | "call-join"
  | "call-leave";

export const SOUND_EVENTS: readonly SoundEvent[] = [
  "message",
  "mention",
  "call-ring",
  "call-connect",
  "call-join",
  "call-leave",
];

export interface SoundSettings {
  /** Master switch for every cue. */
  readonly enabled: boolean;
  /** Master volume, 0..2 (1 is unity, 2 is 200%). */
  readonly volume: number;
  /** Per-event switches; a disabled event stays silent. */
  readonly events: Readonly<Record<SoundEvent, boolean>>;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  events: {
    message: true,
    mention: true,
    "call-ring": true,
    "call-connect": true,
    "call-join": true,
    "call-leave": true,
  },
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Coerces arbitrary stored/partial data onto a complete, valid settings object. */
export function mergeSoundSettings(
  partial: Partial<SoundSettings> | null | undefined,
): SoundSettings {
  const p = partial ?? {};
  const events = { ...DEFAULT_SOUND_SETTINGS.events };
  const rawEvents = (p.events ?? {}) as Partial<Record<SoundEvent, boolean>>;
  for (const event of SOUND_EVENTS) {
    const value = rawEvents[event];
    if (typeof value === "boolean") {
      events[event] = value;
    }
  }
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_SOUND_SETTINGS.enabled,
    volume: clamp(p.volume, 0, 2, DEFAULT_SOUND_SETTINGS.volume),
    events,
  };
}

/** Reads sound settings, falling back to defaults for missing/corrupt data. */
export function loadSoundSettings(store: StorageLike): SoundSettings {
  try {
    const raw = store.getItem(SOUND_SETTINGS_KEY);
    if (raw === null || raw.length === 0) {
      return DEFAULT_SOUND_SETTINGS;
    }
    return mergeSoundSettings(JSON.parse(raw) as Partial<SoundSettings>);
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

/** Persists sound settings; best-effort so blocked storage never breaks audio. */
export function saveSoundSettings(store: StorageLike, settings: SoundSettings): void {
  try {
    store.setItem(SOUND_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage is best-effort.
  }
}

/** In-memory store used when no persistent store is available (native/tests). */
export function memorySoundSettingsStore(seed: Record<string, string> = {}): StorageLike {
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

/** The volume a client should play `event` at, or 0 when it must stay silent. */
export function soundVolume(settings: SoundSettings, event: SoundEvent): number {
  if (!settings.enabled || settings.events[event] !== true) {
    return 0;
  }
  return settings.volume;
}
