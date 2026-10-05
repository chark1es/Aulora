import { mergeSoundSettings, type SoundEvent, type SoundSettings } from "@aulora/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SOUND_SETTINGS,
  loadSoundSettingsAsync,
  playSound,
  saveSoundSettingsAsync,
  soundsAvailable,
} from "../lib/sounds";

export interface SoundContextValue {
  readonly settings: SoundSettings;
  readonly available: boolean;
  readonly updateSettings: (_partial: Partial<SoundSettings>) => Promise<void>;
  readonly play: (_event: SoundEvent) => void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

/** Owns the device's sound cues so every surface plays the same configured volume. */
export function SoundProvider({ children }: { readonly children: ReactNode }) {
  const [settings, setSettings] = useState<SoundSettings>(DEFAULT_SOUND_SETTINGS);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(soundsAvailable());
    void loadSoundSettingsAsync().then(setSettings);
  }, []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const updateSettings = useCallback(async (partial: Partial<SoundSettings>) => {
    const next = mergeSoundSettings({ ...settingsRef.current, ...partial });
    settingsRef.current = next;
    setSettings(next);
    await saveSoundSettingsAsync(next);
  }, []);

  const play = useCallback(
    (event: SoundEvent) => {
      playSound(event, settings);
    },
    [settings],
  );

  const value = useMemo<SoundContextValue>(
    () => ({ settings, available, updateSettings, play }),
    [settings, available, updateSettings, play],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

/** Reads the sound context; returns null outside a {@link SoundProvider}. */
export function useSound(): SoundContextValue | null {
  return useContext(SoundContext);
}
