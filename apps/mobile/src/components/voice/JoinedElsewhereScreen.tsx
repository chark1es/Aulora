import { Button, EmptyState, Text } from "@aulora/ui-native";
import { View } from "react-native";

/**
 * Voice-channel pane when this user is already connected from a different
 * device. Replaces the call screen until they move the call here.
 */
export function JoinedElsewhereScreen({
  channelName,
  pending,
  canJoin,
  onJoin,
}: {
  readonly channelName: string;
  readonly pending: boolean;
  readonly canJoin: boolean;
  readonly onJoin: () => void;
}) {
  return (
    <View className="flex-1 bg-bg min-w-0">
      <EmptyState
        icon="volume"
        title={channelName}
        message="You joined this voice channel from another device. This one stays out of the call."
      >
        {canJoin ? (
          <Button variant="primary" disabled={pending} onPress={onJoin}>
            Join here
          </Button>
        ) : (
          <Text size="sm" tone="muted">
            You do not have permission to move the call to this device.
          </Text>
        )}
      </EmptyState>
    </View>
  );
}
