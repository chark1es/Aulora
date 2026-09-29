import {
  DEFAULT_SOUND_SETTINGS,
  loadSoundSettings,
  mergeSoundSettings,
  SOUND_SETTINGS_KEY,
  type SoundEvent,
  type SoundSettings,
  saveSoundSettings,
  soundVolume,
} from "@aulora/core";
import { useCallback, useEffect, useState } from "react";

/**
 * Synthesized notification cues. Nothing is downloaded: each cue is a tiny
 * WebAudio motif, so a self-hosted Aulora ships no binary audio assets and the
 * volume is read from the device-local `@aulora/core` sound settings.
 */
const memory = new Map<string, string>();

const store = {
  getItem(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

export function readSoundSettings(): SoundSettings {
  return loadSoundSettings(store);
}

export function writeSoundSettings(settings: SoundSettings): void {
  saveSoundSettings(store, settings);
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== "undefined") {
    return AudioContext;
  }
  const legacy = (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return legacy ?? null;
}

let sharedContext: AudioContext | null = null;
let gestureArmed = false;

/**
 * Browsers (and WKWebView) start an audio context suspended until the first
 * user gesture. Resume the shared context on the first interaction so an
 * incoming-call cue, which fires without a gesture, is not silently dropped.
 */
function armGestureResume(): void {
  if (gestureArmed || typeof window === "undefined") {
    return;
  }
  gestureArmed = true;
  const resume = () => {
    void sharedContext?.resume().catch(() => undefined);
  };
  for (const event of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(event, resume, { once: true, passive: true });
  }
}

/** One process-wide context so cues never re-create (and thus re-suspend) one. */
function ensureAudioContext(): AudioContext | null {
  if (sharedContext !== null) {
    return sharedContext;
  }
  const Ctor = audioContextCtor();
  if (Ctor === null) {
    return null;
  }
  try {
    sharedContext = new Ctor();
  } catch {
    return null;
  }
  armGestureResume();
  return sharedContext;
}

interface Tone {
  readonly freq: number;
  readonly at: number;
  readonly duration: number;
  readonly type?: OscillatorType;
  readonly peak?: number;
}

const ONE_SHOTS: Record<Exclude<SoundEvent, "call-ring">, readonly Tone[]> = {
  message: [
    { freq: 660, at: 0, duration: 0.09, peak: 0.18 },
    { freq: 880, at: 0.07, duration: 0.11, peak: 0.14 },
  ],
  mention: [
    { freq: 740, at: 0, duration: 0.1, peak: 0.2 },
    { freq: 988, at: 0.08, duration: 0.12, peak: 0.2 },
  ],
  "call-connect": [
    { freq: 523.25, at: 0, duration: 0.12, peak: 0.18 },
    { freq: 659.25, at: 0.1, duration: 0.12, peak: 0.18 },
    { freq: 783.99, at: 0.2, duration: 0.16, peak: 0.18 },
  ],
  "call-join": [{ freq: 587.33, at: 0, duration: 0.16, peak: 0.16 }],
  "call-leave": [
    { freq: 523.25, at: 0, duration: 0.12, peak: 0.16 },
    { freq: 392, at: 0.1, duration: 0.16, peak: 0.16 },
  ],
};

const RING_TONES: readonly Tone[] = [
  { freq: 587.33, at: 0, duration: 0.28, peak: 0.2 },
  { freq: 440, at: 0.34, duration: 0.32, peak: 0.2 },
];

function schedule(
  context: AudioContext,
  master: GainNode,
  tones: readonly Tone[],
  gain: number,
): void {
  const now = context.currentTime;
  for (const tone of tones) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = tone.type ?? "sine";
    oscillator.frequency.value = tone.freq;
    const peak = Math.max(0.0001, (tone.peak ?? 0.15) * gain);
    const start = now + tone.at;
    const end = start + tone.duration;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

/**
 * Plays a cue at the configured volume. Returns a stop handle (used to silence
 * the looping ring). A no-op when sounds are off, the event is muted, or the
 * environment has no WebAudio.
 */
export function playSound(
  event: SoundEvent,
  settings: SoundSettings = readSoundSettings(),
): () => void {
  const volume = soundVolume(settings, event);
  if (volume <= 0) {
    return () => {};
  }
  const context = ensureAudioContext();
  if (context === null) {
    return () => {};
  }
  if (context.state === "suspended") {
    void context.resume().catch(() => undefined);
  }
  const master = context.createGain();
  master.gain.value = Math.min(2, volume);
  master.connect(context.destination);
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    try {
      master.disconnect();
    } catch {
      // Already disconnected; nothing to release.
    }
  };

  if (event === "call-ring") {
    schedule(context, master, RING_TONES, 1);
    const interval = setInterval(() => schedule(context, master, RING_TONES, 1), 1600);
    return () => {
      clearInterval(interval);
      release();
    };
  }

  schedule(context, master, ONE_SHOTS[event], 1);
  const timer = setTimeout(release, 700);
  return () => {
    clearTimeout(timer);
    release();
  };
}

/** Reactive access to the device-local sound settings. */
export function useSoundSettings(): readonly [
  SoundSettings,
  (partial: Partial<SoundSettings>) => void,
  (events: Partial<Record<SoundEvent, boolean>>) => void,
] {
  const [settings, setSettings] = useState<SoundSettings>(DEFAULT_SOUND_SETTINGS);

  useEffect(() => {
    setSettings(readSoundSettings());
  }, []);

  const update = useCallback((partial: Partial<SoundSettings>) => {
    setSettings((current) => {
      const next = mergeSoundSettings({ ...current, ...partial });
      writeSoundSettings(next);
      return next;
    });
  }, []);

  const updateEvent = useCallback((events: Partial<Record<SoundEvent, boolean>>) => {
    setSettings((current) => {
      const next = mergeSoundSettings({ ...current, events: { ...current.events, ...events } });
      writeSoundSettings(next);
      return next;
    });
  }, []);

  return [settings, update, updateEvent] as const;
}

export { SOUND_SETTINGS_KEY, type SoundEvent, type SoundSettings };
