import { type CallView, callKindLabel } from "@aulora/core";
import { Button, Heading, Text, usePalette } from "@aulora/ui-native";
import { Modal, ScrollView, View } from "react-native";
import { useVoice } from "../../providers/VoiceProvider";
import { MemberAvatar } from "../chat/MemberAvatar";
import { ScreenContainer } from "../layout/ScreenContainer";

export interface IncomingCallModalProps {
  readonly callerName: (_call: CallView) => string;
}

/** Ringing surface for an incoming DM/group-DM call, with accept and decline. */
export function IncomingCallModal({ callerName }: IncomingCallModalProps) {
  const voice = useVoice();
  const palette = usePalette();
  const call = voice.incoming[0] ?? null;

  return (
    <Modal
      visible={call !== null}
      transparent
      animationType="fade"
      onRequestClose={() => undefined}
    >
      <ScreenContainer className="flex-1 bg-black/70 min-w-0">
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
          <View className="w-full items-center gap-4 rounded-card border border-border bg-surface-1 p-6">
            {call !== null && (
              <>
                <MemberAvatar userId={call.initiatorId} size={72} />
                <View className="items-center gap-1">
                  <Heading level={3} numberOfLines={1}>
                    {callerName(call)}
                  </Heading>
                  <Text size="sm" tone="muted">
                    Incoming {callKindLabel(call.kind).toLowerCase()}
                  </Text>
                </View>
                <View className="mt-2 w-full flex-row gap-3">
                  <Button
                    variant="danger"
                    className="flex-1 min-w-0"
                    onPress={() => void voice.declineCall(call.id)}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1 min-w-0"
                    onPress={() => void voice.acceptCall(call)}
                  >
                    Accept
                  </Button>
                </View>
                <Text size="xs" style={{ color: palette["text-muted"] }}>
                  Accepting joins you with the microphone muted.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      </ScreenContainer>
    </Modal>
  );
}
