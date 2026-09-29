import { Avatar, userAvatarSeed } from "@aulora/avatars";
import { type CallParticipantView, sortParticipants, type VoiceDeviceSettings } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useEffect, useMemo, useRef } from "react";
import { type CallIdentity, shouldMirror } from "./identity";

/**
 * Renders a video track or stream. Muted so the hidden `RemoteAudio` elements
 * own all playback (no double audio), and mirrored for the local self-view.
 */
export function VideoSurface({
  stream,
  track,
  mirror = false,
  fit = "cover",
  className,
}: {
  readonly stream?: MediaStream | null;
  readonly track?: MediaStreamTrack | null;
  readonly mirror?: boolean;
  readonly fit?: "cover" | "contain";
  readonly className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const media = useMemo(() => {
    if (stream !== null && stream !== undefined && stream.getVideoTracks().length > 0) {
      return stream;
    }
    if (track !== null && track !== undefined) {
      return new MediaStream([track]);
    }
    return null;
  }, [stream, track]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    element.srcObject = media;
    if (media !== null) {
      void element.play().catch(() => undefined);
    }
    return () => {
      element.srcObject = null;
    };
  }, [media]);

  if (media === null) {
    return null;
  }
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        "h-full w-full",
        fit === "contain" ? "object-contain" : "object-cover",
        mirror && "-scale-x-100",
        className,
      )}
    />
  );
}

const CONNECTION_LABEL: Record<CallParticipantView["connection"], string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Connection lost",
};

const CONNECTION_COLOR: Record<CallParticipantView["connection"], string> = {
  connecting: "bg-[#E8A33B]",
  connected: "bg-secondary",
  reconnecting: "bg-[#E8A33B]",
  failed: "bg-danger",
};

/** One participant tile: video when available, avatar otherwise, plus status. */
export function ParticipantTile({
  participant,
  isSelf,
  name,
  roleColor,
  stream,
  localVideoTrack,
  settings,
  className,
  avatarSize = 64,
}: {
  readonly participant: CallParticipantView;
  readonly isSelf: boolean;
  readonly name: string;
  readonly roleColor: string | null;
  readonly stream: MediaStream | null;
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly settings: VoiceDeviceSettings;
  readonly className?: string;
  readonly avatarSize?: number;
}) {
  const hasVideo =
    participant.video &&
    participant.connection === "connected" &&
    (isSelf ? localVideoTrack !== null : stream !== null && stream.getVideoTracks().length > 0);

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-card border bg-surface-2 transition",
        participant.speaking && !participant.muted
          ? "border-secondary/70 shadow-[0_0_0_2px_var(--aulora-secondary)]"
          : "border-border",
        className,
      )}
    >
      {hasVideo ? (
        <VideoSurface
          stream={isSelf ? null : stream}
          track={isSelf ? localVideoTrack : null}
          mirror={shouldMirror(isSelf, participant.sharingScreen, settings)}
          fit={participant.sharingScreen ? "contain" : "cover"}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Avatar
            seed={userAvatarSeed(participant.userId)}
            size={avatarSize}
            {...(roleColor !== null && roleColor.length > 0 ? { roleColor } : {})}
          />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2.5 pb-1.5 pt-5">
        {participant.muted && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger/90 text-white">
            <Icon name="mic-off" size={12} strokeWidth={2.25} />
          </span>
        )}
        {participant.sharingScreen && (
          <span
            className="flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent"
            title="Sharing screen"
          >
            <Icon name="monitor" size={11} strokeWidth={2.25} />
            Screen
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white drop-shadow">
          {name}
          {isSelf ? " (you)" : ""}
        </span>
        {participant.connection !== "connected" && (
          <span
            title={CONNECTION_LABEL[participant.connection]}
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              CONNECTION_COLOR[participant.connection],
            )}
          />
        )}
      </div>

      {participant.deafened && (
        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
          <Icon name="headphones-off" size={13} strokeWidth={2.25} />
        </span>
      )}
    </div>
  );
}

/**
 * The participant layout. A screen share takes the stage and everyone else
 * becomes a filmstrip; otherwise tiles flow in an auto-fitting grid.
 */
export function CallGrid({
  participants,
  streams,
  localUserId,
  localVideoTrack,
  settings,
  identity,
  className,
}: {
  readonly participants: readonly CallParticipantView[];
  readonly streams: ReadonlyMap<string, MediaStream>;
  readonly localUserId: string;
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly settings: VoiceDeviceSettings;
  readonly identity: CallIdentity;
  readonly className?: string;
}) {
  const sorted = useMemo(() => sortParticipants(participants), [participants]);
  const sharer = sorted.find((participant) => participant.sharingScreen);
  const rest = sorted.filter((participant) => participant !== sharer);
  const columns = rest.length <= 1 ? 1 : rest.length <= 4 ? 2 : 3;

  const tile = (participant: CallParticipantView) => (
    <ParticipantTile
      key={participant.userId}
      participant={participant}
      isSelf={participant.userId === localUserId}
      name={identity.nameOf(participant.userId)}
      roleColor={identity.colorOf(participant.userId)}
      stream={streams.get(participant.userId) ?? null}
      localVideoTrack={localVideoTrack}
      settings={settings}
    />
  );

  if (sharer !== undefined) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
        <ParticipantTile
          participant={sharer}
          isSelf={sharer.userId === localUserId}
          name={identity.nameOf(sharer.userId)}
          roleColor={identity.colorOf(sharer.userId)}
          stream={streams.get(sharer.userId) ?? null}
          localVideoTrack={localVideoTrack}
          settings={settings}
          className="min-h-0 flex-1"
        />
        {rest.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto">
            {rest.map((participant) => (
              <div key={participant.userId} className="h-24 w-40 shrink-0">
                <ParticipantTile
                  participant={participant}
                  isSelf={participant.userId === localUserId}
                  name={identity.nameOf(participant.userId)}
                  roleColor={identity.colorOf(participant.userId)}
                  stream={streams.get(participant.userId) ?? null}
                  localVideoTrack={localVideoTrack}
                  settings={settings}
                  className="h-full w-full"
                  avatarSize={40}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("grid min-h-0 flex-1 auto-rows-fr gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {sorted.map((participant) => tile(participant))}
    </div>
  );
}
