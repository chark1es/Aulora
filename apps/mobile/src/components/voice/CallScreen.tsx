import {
  CALL_ALONE_HINT_MESSAGE,
  type CallParticipantView,
  callAloneRemainingMs,
  callKindLabel,
  formatAloneCountdown,
  formatCallDuration,
  sortParticipants,
} from "@aulora/core";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type MainVideo, pickMainVideo } from "../../lib/voice/pip";
import { tryCreateMediaStream, type VoiceStream } from "../../lib/voice/webrtc";
import { useVoice } from "../../providers/VoiceProvider";
import { MemberAvatar } from "../chat/MemberAvatar";
import { CallControls } from "./CallControls";
import { CallVideo } from "./CallVideo";

export interface CallScreenProps {
  readonly channelName: string;
  readonly memberNames: ReadonlyMap<string, string>;
}

type Voice = ReturnType<typeof useVoice>;

function displayName(userId: string, memberNames: ReadonlyMap<string, string>): string {
  return memberNames.get(userId) ?? userId;
}

function AvatarFallback({ seed }: { readonly seed: string }) {
  return (
    <View className="flex-1 items-center justify-center">
      <MemberAvatar userId={seed} size={56} />
    </View>
  );
}

function ParticipantOverlay({
  participant,
  name,
  overVideo,
}: {
  readonly participant: CallParticipantView;
  readonly name: string;
  /** Video behind the label: draw a scrim and light text so it stays legible. */
  readonly overVideo: boolean;
}) {
  const palette = usePalette();
  const talking = !participant.muted && participant.speaking;
  const iconColor = overVideo ? "#ffffff" : palette["text-muted"];
  return (
    <View
      className={
        overVideo
          ? "absolute bottom-0 left-0 right-0 flex-row items-center gap-1.5 bg-black/50 px-2 py-1.5"
          : "absolute bottom-0 left-0 right-0 flex-row items-center gap-1.5 px-2 py-1.5"
      }
    >
      {talking && (
        <View className="h-1.5 w-1.5 rounded-pill" style={{ backgroundColor: palette.secondary }} />
      )}
      <Text
        size="xs"
        numberOfLines={1}
        className="min-w-0 flex-1 font-medium"
        style={overVideo ? { color: "#ffffff" } : undefined}
      >
        {name}
      </Text>
      {participant.muted && <Icon name="mic-off" size={13} color={iconColor} />}
      {participant.deafened && <Icon name="headphones-off" size={13} color={iconColor} />}
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
  readonly stream: VoiceStream | null;
  readonly level?: number;
  readonly prominent?: boolean;
  readonly mirror?: boolean;
  /** This is the video the system floats when the app is left (iOS). */
  readonly floats?: boolean;
}

function ParticipantTile(props: ParticipantTileProps) {
  const { participant, name, stream } = props;
  const { level = 0, prominent = false, mirror = false, floats = false } = props;
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
          pip={floats}
          fallback={<AvatarFallback seed={participant.userId} />}
        />
      ) : (
        <AvatarFallback seed={participant.userId} />
      )}
      <ParticipantOverlay
        participant={participant}
        name={name}
        overVideo={showVideo && stream !== null}
      />
    </View>
  );
}

function ParticipantGrid({
  voice,
  memberNames,
  localStream,
  mainUserId,
}: {
  readonly voice: Voice;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly localStream: VoiceStream | null;
  readonly mainUserId: string | null;
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
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 12, gap: 12 }}>
      {sharer !== undefined && (
        <ParticipantTile
          participant={sharer}
          name={displayName(sharer.userId, memberNames)}
          stream={voice.remoteStreams.get(sharer.userId) ?? null}
          level={voice.remoteLevels.get(sharer.userId)}
          prominent
          floats={sharer.userId === mainUserId}
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
              stream={isSelf ? localStream : (voice.remoteStreams.get(participant.userId) ?? null)}
              level={isSelf ? voice.micLevel : voice.remoteLevels.get(participant.userId)}
              mirror={isSelf}
              floats={participant.userId === mainUserId}
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
    <View className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-3">
      <View className="min-w-0 flex-1">
        <Heading level={3} numberOfLines={1}>
          {channelName}
        </Heading>
        <Text size="xs" tone="muted">
          {callKindLabel(kind)} · {duration}
        </Text>
      </View>
      <View className="h-2.5 w-2.5 shrink-0 rounded-pill bg-secondary" />
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
 * The last-minute warning while this device is the only participant. The
 * deadline comes from the server, so it survives a reconnect; "Stay" asks the
 * server to restart the window. Mute, deafen and camera changes do not reset
 * it, which keeps the rule predictable.
 */
function CallAloneBanner({ voice, now }: { readonly voice: Voice; readonly now: number }) {
  const remaining = callAloneRemainingMs(voice.call?.aloneDeadline ?? null, now);
  if (remaining === null) {
    return null;
  }
  return <CallAloneBannerContent voice={voice} remaining={remaining} />;
}

/**
 * Mounts only while the warning is visible, so the one-time iOS announcement
 * happens when the banner appears rather than at the start of the call. The
 * countdown text is exposed as the static sentence, so it is not re-read on
 * every tick.
 */
function CallAloneBannerContent({
  voice,
  remaining,
}: {
  readonly voice: Voice;
  readonly remaining: number;
}) {
  const palette = usePalette();
  useEffect(() => {
    // iOS has no live-region equivalent; announce the static sentence once.
    AccessibilityInfo.announceForAccessibility(CALL_ALONE_HINT_MESSAGE);
  }, []);
  const countdown = formatAloneCountdown(remaining);
  return (
    <View
      accessibilityLiveRegion="polite"
      className="mx-4 mt-2 flex-row items-center gap-2 rounded-input border border-secondary bg-surface-2 px-3 py-2"
    >
      <Icon name="timer" size={14} color={palette.secondary} />
      <Text size="xs" className="min-w-0 flex-1" accessibilityLabel={CALL_ALONE_HINT_MESSAGE}>
        Leaving in {countdown} — nobody else is here
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stay in the call"
        hitSlop={8}
        onPress={() => void voice.stayInCall()}
        className="rounded-input px-2 py-1"
      >
        <Text size="xs" className="font-semibold" style={{ color: palette.secondary }}>
          Stay
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * What the floating window shows: the main video edge to edge, or the avatar of
 * whoever would be on it. No controls: the window is too small to use them.
 */
function FloatingCall({ voice, main }: { readonly voice: Voice; readonly main: MainVideo | null }) {
  const fallbackId =
    main?.userId ??
    voice.call?.participants.find((entry) => entry.userId !== voice.selfUserId)?.userId ??
    voice.selfUserId;
  return (
    <View className="flex-1 bg-black">
      <CallVideo stream={main?.stream ?? null} fallback={<AvatarFallback seed={fallbackId} />} />
    </View>
  );
}

/** The current time, ticking each second while a call is on. */
function useNow(startedAt: number | null): number {
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
  return now;
}

function InCallControls({ voice }: { readonly voice: Voice }) {
  const { local } = voice;
  return (
    <CallControls
      muted={local.muted}
      deafened={local.deafened}
      video={local.video}
      sharingScreen={local.sharingScreen}
      canSpeak={voice.canSpeak}
      canVideo={voice.canVideo}
      canStream={voice.canStream}
      pipSupported={voice.pip.supported}
      onToggleMute={() => void voice.setMuted(!local.muted)}
      onToggleDeafen={() => {
        voice.setDeafened(!local.deafened);
      }}
      onToggleCamera={() => void voice.setCamera(!local.video)}
      onToggleScreen={() => void voice.setScreenSharing(!local.sharingScreen)}
      onPip={voice.pip.enter}
      onLeave={() => void voice.leave()}
    />
  );
}

/**
 * Full-screen call stage: participant tiles with avatar fallbacks, mute,
 * deafen and speaking state, an enlarged screen-share tile, the elapsed
 * duration and the pinned control bar.
 */
export function CallScreen({ channelName, memberNames }: CallScreenProps) {
  const voice = useVoice();
  const { call } = voice;
  const startedAt = call?.startedAt ?? null;
  const now = useNow(startedAt);
  const insets = useSafeAreaInsets();

  const localStream = useMemo(
    () => (voice.localVideoTrack === null ? null : tryCreateMediaStream([voice.localVideoTrack])),
    [voice.localVideoTrack],
  );

  const main = useMemo(
    () => pickMainVideo(call, voice.remoteStreams, voice.selfUserId),
    [call, voice.remoteStreams, voice.selfUserId],
  );

  if (call === null) {
    return <Modal visible={false} transparent onRequestClose={() => undefined} />;
  }

  if (voice.pip.active) {
    return (
      <Modal visible transparent onRequestClose={() => undefined}>
        <FloatingCall voice={voice} main={main} />
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => void voice.leave()}>
      <View
        className="flex-1 bg-bg"
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        <CallHeader
          channelName={channelName}
          kind={call.kind}
          duration={formatCallDuration(now - call.startedAt)}
        />
        {voice.error !== null && <CallError error={voice.error} />}
        <CallAloneBanner voice={voice} now={now} />
        <ParticipantGrid
          voice={voice}
          memberNames={memberNames}
          localStream={localStream}
          mainUserId={main?.userId ?? null}
        />
        <View className="px-4 pb-4 pt-2">
          <InCallControls voice={voice} />
        </View>
      </View>
    </Modal>
  );
}
