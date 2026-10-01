import { type CallView, type ChannelView, joinedElsewhere } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";

export interface VoiceChannelSectionProps {
  readonly channels: readonly ChannelView[];
  readonly activeCalls: readonly CallView[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly selfUserId: string;
  readonly clientId: string | null;
  readonly localCallId: string | null;
  /** Per-participant remote audio level, 0..1, when available. */
  readonly remoteLevels?: ReadonlyMap<string, number>;
  readonly onJoin: (channelId: string) => void;
}

/**
 * The voice-channel list in the drawer: one row per voice channel with the
 * users currently connected, joining on tap. Text/announcement channels are
 * rendered separately and unchanged.
 */
export function VoiceChannelSection({
  channels,
  activeCalls,
  memberNames,
  selfUserId,
  clientId,
  localCallId,
  remoteLevels,
  onJoin,
}: VoiceChannelSectionProps) {
  const palette = usePalette();
  const voiceChannels = channels.filter((channel) => channel.kind === "voice");
  if (voiceChannels.length === 0) {
    return null;
  }
  return (
    <View className="gap-1">
      <Text size="xs" tone="muted" className="px-3 pb-1 uppercase">
        Voice
      </Text>
      {voiceChannels.map((channel) => {
        const call = activeCalls.find((entry) => entry.channelId === channel.id);
        const connected = call?.participants ?? [];
        const selfConnected = connected.some((participant) => participant.userId === selfUserId);
        const elsewhere =
          call !== undefined && joinedElsewhere(call, selfUserId, clientId, localCallId);
        return (
          <Pressable
            key={channel.id}
            accessibilityRole="button"
            accessibilityLabel={`Join voice channel ${channel.name}`}
            onPress={() => onJoin(channel.id)}
            className="gap-1 rounded-input px-3 py-2"
          >
            <View className="flex-row items-center gap-2">
              <Icon
                name="volume"
                size={16}
                color={call !== undefined ? palette.accent : palette["text-muted"]}
              />
              <Text size="sm" className="flex-1" tone={call !== undefined ? "default" : "muted"}>
                {channel.name}
              </Text>
              {selfConnected && (
                <Text size="xs" tone="accent">
                  {elsewhere ? "Other device" : "Joined"}
                </Text>
              )}
              {connected.length > 0 && (
                <Text size="xs" tone="muted">
                  {connected.length}
                </Text>
              )}
            </View>
            {connected.length > 0 && (
              <View className="flex-row flex-wrap gap-2 pl-6">
                {connected.map((participant) => (
                  <View key={participant.userId} className="flex-row items-center gap-1">
                    <Icon
                      name={participant.muted ? "mic-off" : "mic"}
                      size={12}
                      color={
                        !participant.muted && (remoteLevels?.get(participant.userId) ?? 0) > 0.06
                          ? palette.secondary
                          : palette["text-muted"]
                      }
                    />
                    <Text size="xs" tone="muted">
                      {memberNames.get(participant.userId) ?? participant.userId}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
