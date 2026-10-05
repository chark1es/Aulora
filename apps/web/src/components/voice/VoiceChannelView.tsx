import type { CallParticipantView, CallView, ChannelView } from "@aulora/core";
import { joinedElsewhere } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useVoice, type VoiceContextValue } from "../../providers/VoiceProvider";
import { PersonAvatar } from "../chat/member-avatars";
import { CallControls } from "./CallControls";
import { CallMediaNotice } from "./CallMediaNotice";
import { CallGrid } from "./CallParticipant";
import { type CallIdentity, UNKNOWN_IDENTITY } from "./identity";
import { JoinedElsewhere } from "./JoinedElsewhere";

/**
 * The main pane for a voice channel. Before joining it is a calm pre-join
 * screen listing who is already in; once in, it becomes the live call surface
 * with the grid and controls inline.
 */
export function VoiceChannelView({
  channel,
  title,
  identity = UNKNOWN_IDENTITY,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly identity?: CallIdentity;
}) {
  const voice = useVoice();
  const call =
    voice.call?.channelId === channel.id
      ? voice.call
      : (voice.activeCalls.find((entry) => entry.channelId === channel.id) ?? null);
  const elsewhere = joinedElsewhere(call, voice.selfUserId, voice.clientId, voice.callId);
  const inCall = call !== null && voice.callId === call.id && !elsewhere;

  if (call !== null && elsewhere) {
    return (
      <JoinedElsewhere
        title={title}
        pending={voice.pending}
        canConnect={voice.canConnect}
        onJoin={() => void voice.joinCall(call.id)}
      />
    );
  }

  if (call !== null && inCall) {
    return <InCallVoiceView call={call} title={title} identity={identity} voice={voice} />;
  }

  if (call === null) {
    return <PreJoinVoiceView channel={channel} title={title} identity={identity} voice={voice} />;
  }

  return (
    <PreJoinVoiceView
      channel={channel}
      title={title}
      identity={identity}
      call={call}
      voice={voice}
    />
  );
}

function InCallVoiceView({
  call,
  title,
  identity,
  voice,
}: {
  readonly call: CallView;
  readonly title: string;
  readonly identity: CallIdentity;
  readonly voice: VoiceContextValue;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-1">
      <InCallHeader call={call} title={title} voice={voice} />
      <CallMediaNotice />
      <div className="min-h-0 flex-1 p-3">
        <CallGrid
          participants={call.participants}
          streams={voice.remoteStreams}
          localUserId={voice.selfUserId}
          localVideoTrack={voice.localVideoTrack}
          settings={voice.settings}
          identity={identity}
          speakingIds={voice.remoteSpeaking}
          localSpeaking={voice.localSpeaking}
          className="h-full"
        />
      </div>
      <VoiceCallFooter voice={voice} />
    </div>
  );
}

function InCallHeader({
  call,
  title,
  voice,
}: {
  readonly call: CallView;
  readonly title: string;
  readonly voice: VoiceContextValue;
}) {
  return (
    <header className="material-chrome flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border px-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-accent-soft text-accent">
        <Icon name="volume" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[14px] font-semibold text-text">{title}</h2>
        <p className="truncate text-[11px] text-text-muted">
          {call.participants.length} in call
          {voice.local.sharingScreen ? " · You are sharing your screen" : ""}
        </p>
      </div>
      <button
        type="button"
        aria-label="Expand call"
        title="Expand call"
        onClick={() => {
          voice.setView("stage");
        }}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text"
      >
        <Icon name="expand" size={16} />
      </button>
    </header>
  );
}

function VoiceCallFooter({ voice }: { readonly voice: VoiceContextValue }) {
  return (
    <footer className="flex shrink-0 items-center justify-center border-t border-border px-4 py-3">
      <CallControls
        muted={voice.local.muted}
        deafened={voice.local.deafened}
        video={voice.local.video}
        sharingScreen={voice.local.sharingScreen}
        canSpeak={voice.canSpeak}
        canVideo={voice.canVideo}
        canStream={voice.canStream}
        onToggleMute={() => void voice.setMuted(!voice.local.muted)}
        onToggleDeafen={() => {
          voice.setDeafened(!voice.local.deafened);
        }}
        onToggleCamera={() => void voice.setCamera(!voice.local.video)}
        onToggleScreen={() => void voice.setScreenSharing(!voice.local.sharingScreen)}
        onLeave={() => void voice.leave()}
      />
    </footer>
  );
}

function PreJoinVoiceView({
  channel,
  title,
  identity,
  call,
  voice,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly identity: CallIdentity;
  readonly call?: CallView;
  readonly voice: VoiceContextValue;
}) {
  return (
    <div className="pane flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-1 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-accent-soft text-accent">
        <Icon name="volume" size={30} />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-text">{title}</h2>
      <p className="mt-1 max-w-sm text-[13px] text-text-muted">
        {channel.topic !== null && channel.topic.length > 0
          ? channel.topic
          : "A voice channel. Jump in and talk with everyone here."}
      </p>

      <PreJoinParticipants participants={call?.participants ?? []} identity={identity} />
      <PreJoinActions channel={channel} {...(call !== undefined ? { call } : {})} voice={voice} />
    </div>
  );
}

function PreJoinParticipants({
  participants,
  identity,
}: {
  readonly participants: readonly CallParticipantView[];
  readonly identity: CallIdentity;
}) {
  if (participants.length === 0) {
    return null;
  }
  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <div className="flex items-center -space-x-2">
        {participants.slice(0, 5).map((participant) => (
          <PersonAvatar
            key={participant.userId}
            userId={participant.userId}
            size={30}
            className="ring-2 ring-surface-1"
          />
        ))}
      </div>
      <p className="text-[12px] text-text-muted">
        {participants.map((participant) => identity.nameOf(participant.userId)).join(", ")}
      </p>
    </div>
  );
}

function PreJoinActions({
  channel,
  call,
  voice,
}: {
  readonly channel: ChannelView;
  readonly call?: CallView;
  readonly voice: VoiceContextValue;
}) {
  const join = async (kind: "voice" | "video") => {
    if (call !== undefined) {
      await voice.joinCall(call.id);
    } else {
      await voice.startCall(channel.id, kind);
    }
  };

  return (
    <div className="mt-6 flex items-center gap-2">
      {voice.canConnect ? (
        <>
          <button
            type="button"
            onClick={() => void join("voice")}
            disabled={voice.pending}
            className="flex h-11 items-center gap-2 rounded-[10px] bg-secondary px-5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="phone" size={17} />
            Join voice
          </button>
          {voice.canVideo && (
            <button
              type="button"
              onClick={() => void join("video")}
              disabled={voice.pending}
              className="flex h-11 items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-5 text-[14px] font-semibold text-text transition hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="video" size={17} />
              Join with video
            </button>
          )}
        </>
      ) : (
        <p className={cn("text-[13px] text-text-muted")}>
          {voice.policy.enabled
            ? "You do not have permission to join voice here."
            : "Voice and video calls are disabled in this workspace."}
        </p>
      )}
    </div>
  );
}
