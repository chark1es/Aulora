import type { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { useChat } from "./ChatProvider";
import { RemoteAudio, useVoiceValue } from "./voice-provider-controls";
import { VoiceContext } from "./voice-provider-types";

export { useVoice } from "./voice-provider-controls";
export type { CallViewMode, VoiceContextValue, VoicePolicy } from "./voice-provider-types";

export interface VoiceProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly children: ReactNode;
}

/**
 * Owns the call engine for one signed-in device. The engine state, media
 * devices and call UI mode live in {@link useVoiceValue}; this component only
 * wires the viewer's resolved permissions into the context.
 */
export function VoiceProvider({ client, userId, children }: VoiceProviderProps) {
  const { viewerPermissions } = useChat();
  const { value, snapshot, settings } = useVoiceValue({ client, userId, viewerPermissions });

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <RemoteAudio
        streams={snapshot.remoteStreams}
        deafened={snapshot.local.deafened}
        volume={settings.outputVolume}
      />
    </VoiceContext.Provider>
  );
}
