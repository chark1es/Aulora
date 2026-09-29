import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { ChannelView } from "@aulora/core";
import { isParticipant } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";
import { CallControls } from "./CallControls";
import { CallMediaNotice } from "./CallMediaNotice";
import { CallGrid } from "./CallParticipant";
import { type CallIdentity, UNKNOWN_IDENTITY } from "./identity";

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
  const inCall = call !== null && isParticipant(call, voice.selfUserId);

  if (call !== null && inCall) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-surface-1">
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
            onClick={() => voice.setView("stage")}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            <Icon name="expand" size={16} />
          </button>
        </header>
        <CallMediaNotice />
        <div className="min-h-0 flex-1 p-3">
          <CallGrid
            participants={call.participants}
            streams={voice.remoteStreams}
            localUserId={voice.selfUserId}
            localVideoTrack={voice.localVideoTrack}
            settings={voice.settings}
            identity={identity}
            className="h-full"
          />
        </div>
        <footer className="flex shrink-0 items-center justify-center border-t border-border px-4 py-3">
          <CallControls
            muted={voice.local.muted}
            deafened={voice.local.deafened}
            video={voice.local.video}
            sharingScreen={voice.local.sharingScreen}
            canVideo={voice.canVideo}
            canStream={voice.canStream}
            onToggleMute={() => void voice.setMuted(!voice.local.muted)}
            onToggleDeafen={() => voice.setDeafened(!voice.local.deafened)}
            onToggleCamera={() => void voice.setCamera(!voice.local.video)}
            onToggleScreen={() => void voice.setScreenSharing(!voice.local.sharingScreen)}
            onLeave={() => void voice.leave()}
          />
        </footer>
      </div>
    );
  }

  const participants = call?.participants ?? [];
  const join = async (kind: "voice" | "video") => {
    if (call !== null) {
      await voice.joinCall(call.id);
    } else {
      await voice.startCall(channel.id, kind);
    }
  };

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

      {participants.length > 0 && (
        <div className="mt-5 flex flex-col items-center gap-2">
          <div className="flex items-center -space-x-2">
            {participants.slice(0, 5).map((participant) => (
              <Avatar
                key={participant.userId}
                seed={userAvatarSeed(participant.userId)}
                size={30}
                className="ring-2 ring-surface-1"
              />
            ))}
          </div>
          <p className="text-[12px] text-text-muted">
            {participants.map((participant) => identity.nameOf(participant.userId)).join(", ")}
          </p>
        </div>
      )}

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
    </div>
  );
}
