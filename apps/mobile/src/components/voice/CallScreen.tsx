import {
  type CallParticipantView,
  callKindLabel,
  formatCallDuration,
  sortParticipants,
} from "@aulora/core";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { tryCreateMediaStream, type VoiceStream } from "../../lib/voice/webrtc";
import { useVoice } from "../../providers/VoiceProvider";
import { MemberAvatar } from "../chat/MemberAvatar";
import { CallControls } from "./CallControls";
import { CallVideo } from "./CallVideo";

export interface CallScreenProps {
  readonly channelName: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
}

type Voice = ReturnType<typeof useVoice>;

function displayName(userId: string, memberNames: ReadonlyMap<string, string>): string {
  return memberNames.get(userId) ?? userId;
}

function AvatarFallback({ seed, color }: { readonly seed: string; readonly color?: string }) {
  return (
    <View className="flex-1 items-center justify-center">
      <MemberAvatar userId={seed} size={56} roleColor={color} />
    </View>
  );
}

function ParticipantOverlay({
  participant,
  name,
}: {
  readonly participant: CallParticipantView;
  readonly name: string;
}) {
  const palette = usePalette();
  const talking = !participant.muted && participant.speaking;
  return (
    <View className="absolute bottom-2 left-2 right-2 flex-row items-center gap-1.5">
      {talking && (
        <View className="h-1.5 w-1.5 rounded-pill" style={{ backgroundColor: palette.secondary }} />
      )}
      <Text size="xs" numberOfLines={1} className="flex-1 font-medium">
        {name}
      </Text>
      {participant.muted && <Icon name="mic-off" size={13} color={palette["text-muted"]} />}
      {participant.deafened && (
        <Icon name="headphones-off" size={13} color={palette["text-muted"]} />
      )}
      {participant.connection === "failed" && (
        <Icon name="signal" size={13} color={palette.danger} />
      )}
      {participant.connection === "reconnecting" && (
        <Icon name="signal" size={13} color={palette.secondary} />
      )}
    </View>
  );
}

interface ParticipantTileProps {
  readonly participant: CallParticipantView;
  readonly name: string;
  readonly color: string | undefined;
  readonly stream: VoiceStream | null;
  readonly level?: number;
  readonly prominent?: boolean;
  readonly mirror?: boolean;
}

function ParticipantTile({
  participant,
  name,
  color,
  stream,
  level = 0,
  prominent = false,
  mirror = false,
}: ParticipantTileProps) {
  const palette = usePalette();
  const showVideo = participant.video || participant.sharingScreen;
  const talking = !participant.muted && (participant.speaking || level > 0.06);
  const ring = talking ? palette.secondary : palette.border;
  return (
    <View
      className={
        prominent
          ? "h-64 w-full overflow-hidden rounded-card border bg-surface-2"
          : "h-40 flex-1 overflow-hidden rounded-card border bg-surface-2"
      }
      style={{ borderColor: ring, borderWidth: talking ? 2 : 1, minWidth: 150 }}
    >
      {showVideo && stream !== null ? (
        <CallVideo
          stream={stream}
          mirror={mirror}
          fallback={<AvatarFallback seed={participant.userId} color={color} />}
        />
      ) : (
        <AvatarFallback seed={participant.userId} color={color} />
      )}
      <ParticipantOverlay participant={participant} name={name} />
    </View>
  );
}

function ParticipantGrid({
  voice,
  memberNames,
  memberColors,
  localStream,
}: {
  readonly voice: Voice;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly localStream: VoiceStream | null;
}) {
  const call = voice.call;
  if (call === null) {
    return null;
  }
  const ordered = sortParticipants(call.participants);
  const sharerId = call.screenShareUserId;
  const sharer = sharerId === null ? undefined : ordered.find((entry) => entry.userId === sharerId);
  const tiles = ordered.filter((entry) => entry.userId !== sharerId);
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
      {sharer !== undefined && (
        <ParticipantTile
          participant={sharer}
          name={displayName(sharer.userId, memberNames)}
          color={memberColors.get(sharer.userId)}
          stream={voice.remoteStreams.get(sharer.userId) ?? null}
          level={voice.remoteLevels.get(sharer.userId)}
          prominent
        />
      )}
      <View className="flex-row flex-wrap gap-3">
        {tiles.map((participant) => {
          const isSelf = participant.userId === voice.selfUserId;
          return (
            <ParticipantTile
              key={participant.userId}
              participant={participant}
              name={isSelf ? "You" : displayName(participant.userId, memberNames)}
              color={memberColors.get(participant.userId)}
              stream={isSelf ? localStream : (voice.remoteStreams.get(participant.userId) ?? null)}
              level={isSelf ? voice.micLevel : voice.remoteLevels.get(participant.userId)}
              mirror={isSelf}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

function CallHeader({
  channelName,
  kind,
  duration,
}: {
  readonly channelName: string;
  readonly kind: Parameters<typeof callKindLabel>[0];
  readonly duration: string;
}) {
  return (
    <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
      <View className="flex-1">
        <Heading level={3} numberOfLines={1}>
          {channelName}
        </Heading>
        <Text size="xs" tone="muted">
          {callKindLabel(kind)} · {duration}
        </Text>
      </View>
      <View className="h-2.5 w-2.5 rounded-pill bg-secondary" />
    </View>
  );
}

function CallError({ error }: { readonly error: string }) {
  return (
    <View className="mx-4 mt-2 rounded-input border border-danger bg-surface-2 px-3 py-2">
      <Text size="xs" tone="danger">
        {error}
      </Text>
    </View>
  );
}

/**
 * Full-screen call stage: participant tiles with avatar fallbacks, mute,
 * deafen and speaking state, an enlarged screen-share tile, the elapsed
 * duration and the pinned control bar.
 */
export function CallScreen({ channelName, memberNames, memberColors }: CallScreenProps) {
  const voice = useVoice();
  const { call, local } = voice;
  const startedAt = call?.startedAt ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt]);

  const localStream = useMemo(
    () => (voice.localVideoTrack === null ? null : tryCreateMediaStream([voice.localVideoTrack])),
    [voice.localVideoTrack],
  );

  if (call === null) {
    return <Modal visible={false} transparent onRequestClose={() => undefined} />;
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => void voice.leave()}>
      <View className="flex-1 bg-bg">
        <CallHeader
          channelName={channelName}
          kind={call.kind}
          duration={formatCallDuration(now - call.startedAt)}
        />
        {voice.error !== null && <CallError error={voice.error} />}
        <ParticipantGrid
          voice={voice}
          memberNames={memberNames}
          memberColors={memberColors}
          localStream={localStream}
        />
        <View className="px-4 pb-6 pt-2">
          <CallControls
            muted={local.muted}
            deafened={local.deafened}
            video={local.video}
            sharingScreen={local.sharingScreen}
            canSpeak={voice.canSpeak}
            canVideo={voice.canVideo}
            canStream={voice.canStream}
            pipPinned={voice.pipPinned}
            onToggleMute={() => void voice.setMuted(!local.muted)}
            onToggleDeafen={() => {
              voice.setDeafened(!local.deafened);
            }}
            onToggleCamera={() => void voice.setCamera(!local.video)}
            onToggleScreen={() => void voice.setScreenSharing(!local.sharingScreen)}
            onTogglePin={() => {
              voice.setPipPinned(!voice.pipPinned);
            }}
            onLeave={() => void voice.leave()}
          />
        </View>
      </View>
    </Modal>
  );
}
