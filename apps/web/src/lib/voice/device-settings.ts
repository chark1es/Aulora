import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceDeviceSettings,
} from "@aulora/core";

/**
 * Device-local voice preferences. Backed by `localStorage` where available and
 * a memory store otherwise (SSR / private mode), so a blocked storage never
 * breaks a call.
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

export function readVoiceSettings(): VoiceDeviceSettings {
  return loadVoiceSettings(store);
}

export function writeVoiceSettings(settings: VoiceDeviceSettings): void {
  saveVoiceSettings(store, settings);
}

export type { VoiceDeviceSettings };
export { DEFAULT_VOICE_SETTINGS };
