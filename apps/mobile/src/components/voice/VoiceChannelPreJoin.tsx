import type { CallParticipantView } from "@aulora/core";
import { Button, Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { View } from "react-native";
import { MemberAvatar } from "../chat/MemberAvatar";
import { GuestBadge, participantLabel } from "./VoiceChannelSection";

export interface VoiceChannelPreJoinProps {
  readonly channelName: string;
  readonly topic?: string | null | undefined;
  readonly participants: readonly CallParticipantView[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly canConnect: boolean;
  readonly canVideo: boolean;
  readonly pending: boolean;
  /** This device is already in the call behind a minimized call surface. */
  readonly joined: boolean;
  readonly onJoin: (_kind: "voice" | "video") => void;
  /** Brings the minimized call surface back for a call this device is in. */
  readonly onRejoin: () => void;
}

/**
 * A voice channel before this device joins. It names everyone already in the
 * call and waits for an explicit join, matching the desktop channel view
 * instead of dropping the person straight into the call from the channel list.
 */
export function VoiceChannelPreJoin({
  channelName,
  topic,
  participants,
  memberNames,
  canConnect,
  canVideo,
  pending,
  joined,
  onJoin,
  onRejoin,
}: VoiceChannelPreJoinProps) {
  const palette = usePalette();
  const names = participants.map((participant) => participantLabel(participant, memberNames));
  return (
    <View className="flex-1 items-center justify-center bg-bg px-6 py-10 min-w-0">
      <View className="w-full max-w-[520px] items-center">
        <Icon name="volume" size={26} color={palette.accent} />
        <Heading level={2} className="mt-3 text-center" accessibilityRole="header">
          {channelName}
        </Heading>
        <Text size="sm" tone="muted" className="mt-1 text-center leading-6">
          {topic !== null && topic !== undefined && topic.length > 0
            ? topic
            : "A voice channel. Join to talk with everyone here."}
        </Text>

        {participants.length > 0 ? (
          <View className="mt-6 items-center gap-2">
            <View className="flex-row items-center justify-center gap-1">
              {participants.slice(0, 5).map((participant) => (
                <MemberAvatar key={participant.userId} userId={participant.userId} size={32} />
              ))}
            </View>
            <Text size="sm" tone="muted" className="text-center">
              {names.join(", ")}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <Text size="xs" tone="muted">
                {participants.length} {participants.length === 1 ? "person" : "people"} in the call
              </Text>
              {participants.some((participant) => participant.isGuest === true) && <GuestBadge />}
            </View>
          </View>
        ) : (
          <Text size="sm" tone="muted" className="mt-6 text-center">
            No one is in the call yet. Join to start it.
          </Text>
        )}

        {joined ? (
          <View className="mt-6 items-center gap-2">
            <Text size="sm" tone="muted" className="text-center">
              You are in this call.
            </Text>
            <Button variant="secondary" onPress={onRejoin}>
              Return to call
            </Button>
          </View>
        ) : canConnect ? (
          <View className="mt-6 flex-row flex-wrap items-center justify-center gap-2">
            <Button loading={pending} disabled={pending} onPress={() => onJoin("voice")}>
              Join voice
            </Button>
            {canVideo && (
              <Button
                variant="secondary"
                loading={pending}
                disabled={pending}
                onPress={() => onJoin("video")}
              >
                Join with video
              </Button>
            )}
          </View>
        ) : (
          <Text size="sm" tone="muted" className="mt-6 text-center">
            You do not have permission to join calls.
          </Text>
        )}
      </View>
    </View>
  );
}
