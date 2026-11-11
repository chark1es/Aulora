import { type CallEndNotice, callAloneTimeoutLabel } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import type { ConvexReactClient } from "convex/react";
import { type ReactNode, useEffect } from "react";
import { Pressable, View } from "react-native";
import { useScreenInsets } from "../components/layout/ScreenContainer";
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

/** How long the disconnect notice stays before it fades out on its own. */
const NOTICE_TIMEOUT_MS = 12_000;

/**
 * A non-blocking notice after the server disconnected this device for being
 * alone in a call. It overlays whatever screen the person landed on, because
 * the call UI is already gone when it appears.
 */
function CallEndedBanner({
  notice,
  onDismiss,
}: {
  readonly notice: CallEndNotice | null;
  readonly onDismiss: () => void;
}) {
  const palette = usePalette();
  const insets = useScreenInsets();

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(onDismiss, NOTICE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice, onDismiss]);

  if (notice === null) {
    return null;
  }

  return (
    <View
      accessibilityRole="alert"
      style={{
        position: "absolute",
        top: insets.top + 8,
        left: insets.left + 12,
        right: insets.right + 12,
        zIndex: 50,
      }}
      className="flex-row items-start gap-2 rounded-card border border-border bg-surface-1 px-3 py-2.5"
    >
      <Icon name="timer" size={15} color={palette.accent} />
      <Text size="xs" className="min-w-0 flex-1">
        You were disconnected because you were alone in the call for{" "}
        {callAloneTimeoutLabel(notice.timeoutSeconds)}.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        className="min-h-11 min-w-11 items-center justify-center"
        onPress={onDismiss}
      >
        <Icon name="x" size={14} color={palette["text-muted"]} />
      </Pressable>
    </View>
  );
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
      <CallEndedBanner notice={snapshot.endedNotice} onDismiss={value.dismissEndedNotice} />
    </VoiceContext.Provider>
  );
}
