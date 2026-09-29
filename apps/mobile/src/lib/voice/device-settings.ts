import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  VOICE_SETTINGS_KEY,
  type VoiceDeviceSettings,
} from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Device-local voice preferences. `@aulora/core`'s helpers take a synchronous
 * store, so an in-memory cache is hydrated once from AsyncStorage and every
 * save writes through to both: reads stay synchronous for the call engine,
 * while the value survives a restart.
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

/** Hydrates the cache from AsyncStorage, then reads the merged settings. */
export async function loadVoiceSettingsAsync(): Promise<VoiceDeviceSettings> {
  if (!hydrated) {
    try {
      const raw = await AsyncStorage.getItem(VOICE_SETTINGS_KEY);
      if (raw !== null) {
        memory.set(VOICE_SETTINGS_KEY, raw);
      }
    } catch {
      // A blocked store must never break a call; defaults are used instead.
    }
    hydrated = true;
  }
  return loadVoiceSettings(store);
}

/** Persists settings in-memory immediately and to AsyncStorage best-effort. */
export async function saveVoiceSettingsAsync(settings: VoiceDeviceSettings): Promise<void> {
  saveVoiceSettings(store, settings);
  try {
    await AsyncStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage is best-effort.
  }
}

export type { VoiceDeviceSettings };
export { DEFAULT_VOICE_SETTINGS };
