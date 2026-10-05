import { type CallView, callKindLabel, callStatusLabel, isOnThisDevice } from "@aulora/core";
import { Button, cn, Icon } from "@aulora/ui-web";
import { useVoice, type VoiceContextValue } from "../../providers/VoiceProvider";
import { CallControls } from "./CallControls";
import { CallMediaNotice } from "./CallMediaNotice";
import { CallGrid } from "./CallParticipant";
import { useCallDuration } from "./hooks";
import { type CallIdentity, UNKNOWN_IDENTITY } from "./identity";

/** The full call surface: a top bar, the participant grid, and controls below. */
export function CallStage({
  title,
  identity = UNKNOWN_IDENTITY,
}: {
  readonly title: string;
  readonly identity?: CallIdentity;
}) {
  const voice = useVoice();
  const duration = useCallDuration(voice.call?.startedAt ?? null);
  const call = voice.call;
  if (call === null) {
    return null;
  }
  const inCall = isOnThisDevice(call, voice.selfUserId, voice.clientId);
  const sharer = call.screenShareUserId !== null ? identity.nameOf(call.screenShareUserId) : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-bg/95 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={`${callKindLabel(call.kind)} in ${title}`}
    >
      <CallStageHeader
        title={title}
        call={call}
        duration={duration}
        sharer={sharer}
        voice={voice}
      />

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

      <CallStageFooter call={call} inCall={inCall} voice={voice} />
    </div>
  );
}

function CallStageHeader({
  title,
  call,
  duration,
  sharer,
  voice,
}: {
  readonly title: string;
  readonly call: CallView;
  readonly duration: string;
  readonly sharer: string | null;
  readonly voice: VoiceContextValue;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
        <Icon name={call.kind === "video" ? "video" : "volume"} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[14px] font-semibold text-text">{title}</h2>
        <p className="truncate text-[11px] text-text-muted">
          {callStatusLabel(call.status)} · {duration} · {call.participants.length} in call
          {sharer !== null ? ` · ${sharer} is sharing` : ""}
        </p>
      </div>
      {voice.canStream && (
        <ShareButton
          sharingScreen={voice.local.sharingScreen}
          onToggle={() => void voice.setScreenSharing(!voice.local.sharingScreen)}
        />
      )}
      <button
        type="button"
        aria-label="Minimize call"
        title="Minimize call"
        onClick={() => {
          voice.setView("dock");
        }}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text"
      >
        <Icon name="chevron-down" size={18} />
      </button>
    </header>
  );
}

function ShareButton({
  sharingScreen,
  onToggle,
}: {
  readonly sharingScreen: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={sharingScreen ? "Stop sharing" : "Share screen"}
      title={sharingScreen ? "Stop sharing" : "Share screen"}
      onClick={onToggle}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium transition",
        sharingScreen
          ? "bg-accent/15 text-accent"
          : "text-text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      <Icon name={sharingScreen ? "monitor-off" : "monitor"} size={15} />
      {sharingScreen ? "Stop" : "Share"}
    </button>
  );
}

function CallStageFooter({
  call,
  inCall,
  voice,
}: {
  readonly call: CallView;
  readonly inCall: boolean;
  readonly voice: VoiceContextValue;
}) {
  return (
    <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-border px-4 py-3">
      {!inCall && (
        <Button
          type="button"
          variant="success"
          size="lg"
          className="mr-2"
          onClick={() => void voice.joinCall(call.id)}
        >
          Join
        </Button>
      )}
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
