import {
  DEFAULT_SOUND_SETTINGS,
  loadSoundSettings,
  SOUND_SETTINGS_KEY,
  type SoundEvent,
  type SoundSettings,
  saveSoundSettings,
  soundVolume,
} from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Device-local notification and call cues. `@aulora/core` owns the settings
 * shape and the volume maths; this module only persists them and plays the
 * bundled WAV assets through `expo-audio`, which is required lazily so the app
 * still runs when the native module is unavailable.
 */

const memory = new Map<string, string>();
let hydrated = false;

const store = {
  getItem(key: string): string | null {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    memory.set(key, value);
  },
  removeItem(key: string): void {
    memory.delete(key);
  },
};

export async function loadSoundSettingsAsync(): Promise<SoundSettings> {
  if (!hydrated) {
    try {
      const raw = await AsyncStorage.getItem(SOUND_SETTINGS_KEY);
      if (raw !== null) {
        memory.set(SOUND_SETTINGS_KEY, raw);
      }
    } catch {
      // Blocked storage must never break audio; defaults are used instead.
    }
    hydrated = true;
  }
  return loadSoundSettings(store);
}

export async function saveSoundSettingsAsync(settings: SoundSettings): Promise<void> {
  saveSoundSettings(store, settings);
  try {
    await AsyncStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage is best-effort.
  }
}

export type { SoundEvent, SoundSettings };
export { DEFAULT_SOUND_SETTINGS, soundVolume };

declare const require: (id: string) => unknown;

interface AudioPlayerLike {
  volume: number;
  play(): void;
  seekTo(seconds: number): void;
  remove(): void;
}

interface AudioModule {
  createAudioPlayer(source: unknown): AudioPlayerLike;
}

let audioModule: AudioModule | null = null;
let audioProbed = false;

function loadAudioModule(): AudioModule | null {
  if (audioProbed) {
    return audioModule;
  }
  audioProbed = true;
  try {
    const mod = require("expo-audio") as AudioModule;
    audioModule = typeof mod.createAudioPlayer === "function" ? mod : null;
  } catch {
    audioModule = null;
  }
  return audioModule;
}

/** Whether the native audio module resolved on this build. */
export function soundsAvailable(): boolean {
  return loadAudioModule() !== null;
}

const SOURCES: Record<SoundEvent, unknown> = {
  message: require("../../assets/sounds/message.wav"),
  mention: require("../../assets/sounds/mention.wav"),
  "call-ring": require("../../assets/sounds/call-ring.wav"),
  "call-connect": require("../../assets/sounds/call-connect.wav"),
  "call-join": require("../../assets/sounds/call-join.wav"),
  "call-leave": require("../../assets/sounds/call-leave.wav"),
};
// expo-audio caps player.volume at 1. These assets have 6–9 dB of headroom,
// so a second set with doubled sample amplitude makes 100–200% real on mobile.
const BOOSTED_SOURCES: Record<SoundEvent, unknown> = {
  message: require("../../assets/sounds/message-boosted.wav"),
  mention: require("../../assets/sounds/mention-boosted.wav"),
  "call-ring": require("../../assets/sounds/call-ring-boosted.wav"),
  "call-connect": require("../../assets/sounds/call-connect-boosted.wav"),
  "call-join": require("../../assets/sounds/call-join-boosted.wav"),
  "call-leave": require("../../assets/sounds/call-leave-boosted.wav"),
};

const players = new Map<string, AudioPlayerLike>();

function playerFor(
  module: AudioModule,
  event: SoundEvent,
  boosted: boolean,
): AudioPlayerLike | null {
  const key = `${event}:${boosted}`;
  const existing = players.get(key);
  if (existing !== undefined) {
    return existing;
  }
  try {
    const player = module.createAudioPlayer(boosted ? BOOSTED_SOURCES[event] : SOURCES[event]);
    players.set(key, player);
    return player;
  } catch {
    return null;
  }
}

/** Plays one cue at the configured volume; silent when disabled or unavailable. */
export function playSound(event: SoundEvent, settings: SoundSettings): boolean {
  const volume = soundVolume(settings, event);
  if (volume <= 0) {
    return false;
  }
  const module = loadAudioModule();
  if (module === null) {
    return false;
  }
  const boosted = volume > 1;
  const player = playerFor(module, event, boosted);
  if (player === null) {
    return false;
  }
  try {
    player.volume = boosted ? volume / 2 : volume;
    player.seekTo(0);
    player.play();
    return true;
  } catch {
    return false;
  }
}

/** Releases cached players, e.g. on sign-out. */
export function disposeSounds(): void {
  for (const player of players.values()) {
    try {
      player.remove();
    } catch {
      // Best-effort.
    }
  }
  players.clear();
}
