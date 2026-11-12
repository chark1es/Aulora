import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { VoiceLevelsStore } from "../lib/voice/levels";

/**
 * Access to the high-frequency call values. Kept separate from the main voice
 * context so a 10 Hz level tick only wakes the components reading that value.
 */
const VoiceLevelsContext = createContext<VoiceLevelsStore | null>(null);

export function VoiceLevelsProvider({
  store,
  children,
}: {
  readonly store: VoiceLevelsStore;
  readonly children: ReactNode;
}) {
  return <VoiceLevelsContext.Provider value={store}>{children}</VoiceLevelsContext.Provider>;
}

/** The store itself, for the rare consumer that needs to read several values. */
export function useVoiceLevels(): VoiceLevelsStore {
  const store = useContext(VoiceLevelsContext);
  if (store === null) {
    throw new Error("useVoiceLevels must be used within a VoiceProvider.");
  }
  return store;
}

/** The local microphone level, 0..1, at meter rate. */
export function useMicLevel(): number {
  const store = useVoiceLevels();
  return useSyncExternalStore(store.subscribeMic, store.getMicLevel);
}
