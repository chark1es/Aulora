import { Button, Heading, Icon, Text, usePalette } from "@aulora/ui-native";
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
  const palette = usePalette();
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
      <Icon name="monitor" size={36} color={palette.accent} />
      <Heading level={3} className="text-center">
        {channelName}
      </Heading>
      <Text size="sm" tone="muted" className="text-center">
        You joined this voice channel from another device. This one stays out of the call.
      </Text>
      {canJoin ? (
        <Button variant="primary" className="mt-3" disabled={pending} onPress={onJoin}>
          Join here
        </Button>
      ) : (
        <Text size="sm" tone="muted" className="text-center">
          You do not have permission to move the call to this device.
        </Text>
      )}
    </View>
  );
}
