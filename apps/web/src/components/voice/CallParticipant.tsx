import { type CallParticipantView, sortParticipants, type VoiceDeviceSettings } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useEffect, useMemo, useRef } from "react";
import { PersonAvatar } from "../chat/member-avatars";
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
  connecting: "bg-idle",
  connected: "bg-secondary",
  reconnecting: "bg-idle",
  failed: "bg-danger",
};

export interface ParticipantTileProps {
  readonly participant: CallParticipantView;
  readonly isSelf: boolean;
  readonly name: string;
  readonly roleColor: string | null;
  readonly stream: MediaStream | null;
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly settings: VoiceDeviceSettings;
  /** Local override from the remote level meter; wins over the server field. */
  readonly speaking?: boolean | undefined;
  readonly className?: string;
  readonly avatarSize?: number;
}

/** One participant tile: video when available, avatar otherwise, plus status. */
export function ParticipantTile(props: ParticipantTileProps) {
  const {
    participant,
    isSelf,
    name,
    roleColor,
    stream,
    localVideoTrack,
    settings,
    speaking,
    className,
    avatarSize = 64,
  } = props;
  const isSpeaking = speaking ?? participant.speaking;

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-card border bg-surface-2 transition",
        isSpeaking && !participant.muted
          ? "border-secondary/70 shadow-[0_0_0_2px_var(--aulora-secondary)]"
          : "border-border",
        className,
      )}
    >
      <ParticipantMedia
        participant={participant}
        isSelf={isSelf}
        stream={stream}
        localVideoTrack={localVideoTrack}
        settings={settings}
        avatarSize={avatarSize}
        roleColor={roleColor}
      />

      <ParticipantChrome
        participant={participant}
        isSelf={isSelf}
        name={name}
        isSpeaking={isSpeaking}
      />

      {participant.deafened && (
        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
          <Icon name="headphones-off" size={13} />
        </span>
      )}
    </div>
  );
}

function ParticipantMedia({
  participant,
  isSelf,
  stream,
  localVideoTrack,
  settings,
  avatarSize,
  roleColor,
}: {
  readonly participant: CallParticipantView;
  readonly isSelf: boolean;
  readonly stream: MediaStream | null;
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly settings: VoiceDeviceSettings;
  readonly avatarSize: number;
  readonly roleColor: string | null;
}) {
  const hasVideo =
    participant.video &&
    participant.connection === "connected" &&
    (isSelf ? localVideoTrack !== null : stream !== null && stream.getVideoTracks().length > 0);
  if (!hasVideo) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <PersonAvatar userId={participant.userId} size={avatarSize} roleColor={roleColor} />
      </div>
    );
  }
  return (
    <VideoSurface
      stream={isSelf ? null : stream}
      track={isSelf ? localVideoTrack : null}
      mirror={shouldMirror(isSelf, participant.sharingScreen, settings)}
      fit={participant.sharingScreen ? "contain" : "cover"}
    />
  );
}

function ParticipantChrome({
  participant,
  isSelf,
  name,
  isSpeaking,
}: {
  readonly participant: CallParticipantView;
  readonly isSelf: boolean;
  readonly name: string;
  readonly isSpeaking: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2.5 pb-1.5 pt-5">
      {participant.muted && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger/90 text-on-accent">
          <Icon name="mic-off" size={12} />
        </span>
      )}
      {participant.sharingScreen && (
        <span
          className="flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent"
          title="Sharing screen"
        >
          <Icon name="monitor" size={11} />
          Screen
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white drop-shadow">
        {name}
        {isSelf ? " (you)" : ""}
      </span>
      {isSelf && isSpeaking && !participant.muted && (
        <span className="shrink-0 rounded-full bg-secondary/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          Speaking
        </span>
      )}
      {participant.connection !== "connected" && (
        <span
          title={CONNECTION_LABEL[participant.connection]}
          className={cn("h-2 w-2 shrink-0 rounded-full", CONNECTION_COLOR[participant.connection])}
        />
      )}
    </div>
  );
}

export interface CallGridProps {
  readonly participants: readonly CallParticipantView[];
  readonly streams: ReadonlyMap<string, MediaStream>;
  readonly localUserId: string;
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly settings: VoiceDeviceSettings;
  readonly identity: CallIdentity;
  /** Remote users currently speaking, from the local audio level meter. */
  readonly speakingIds?: ReadonlySet<string>;
  readonly localSpeaking?: boolean;
  readonly className?: string;
}

interface TileContext {
  readonly streams: ReadonlyMap<string, MediaStream>;
  readonly localUserId: string;
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly settings: VoiceDeviceSettings;
  readonly identity: CallIdentity;
  readonly speakingIds: ReadonlySet<string> | undefined;
  readonly localSpeaking: boolean;
}

/**
 * The participant layout. A screen share takes the stage and everyone else
 * becomes a filmstrip; otherwise tiles flow in an auto-fitting grid.
 */
export function CallGrid(props: CallGridProps) {
  const {
    participants,
    streams,
    localUserId,
    localVideoTrack,
    settings,
    identity,
    speakingIds,
    localSpeaking = false,
    className,
  } = props;
  const context: TileContext = {
    streams,
    localUserId,
    localVideoTrack,
    settings,
    identity,
    speakingIds,
    localSpeaking,
  };
  const sorted = useMemo(() => sortParticipants(participants), [participants]);
  const sharer = sorted.find((participant) => participant.sharingScreen);
  const rest = sorted.filter((participant) => participant !== sharer);

  if (sharer !== undefined) {
    return (
      <ScreenShareLayout sharer={sharer} rest={rest} context={context} className={className} />
    );
  }

  const columns = rest.length <= 1 ? 1 : rest.length <= 4 ? 2 : 3;
  return (
    <div
      className={cn("grid min-h-0 flex-1 auto-rows-fr gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {sorted.map((participant) => (
        <Tile key={participant.userId} participant={participant} context={context} />
      ))}
    </div>
  );
}

function ScreenShareLayout({
  sharer,
  rest,
  context,
  className,
}: {
  readonly sharer: CallParticipantView;
  readonly rest: readonly CallParticipantView[];
  readonly context: TileContext;
  readonly className: string | undefined;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <Tile participant={sharer} context={context} className="min-h-0 flex-1" />
      {rest.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto">
          {rest.map((participant) => (
            <div key={participant.userId} className="h-24 w-40 shrink-0">
              <Tile
                participant={participant}
                context={context}
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

function Tile({
  participant,
  context,
  className,
  avatarSize,
}: {
  readonly participant: CallParticipantView;
  readonly context: TileContext;
  readonly className?: string;
  readonly avatarSize?: number;
}) {
  return (
    <ParticipantTile
      participant={participant}
      isSelf={participant.userId === context.localUserId}
      name={context.identity.nameOf(participant.userId)}
      roleColor={context.identity.colorOf(participant.userId)}
      stream={context.streams.get(participant.userId) ?? null}
      localVideoTrack={context.localVideoTrack}
      settings={context.settings}
      speaking={
        participant.userId === context.localUserId
          ? context.localSpeaking
          : context.speakingIds?.has(participant.userId)
      }
      {...(className !== undefined ? { className } : {})}
      {...(avatarSize !== undefined ? { avatarSize } : {})}
    />
  );
}
