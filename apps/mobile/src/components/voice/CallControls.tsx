import { Icon, IconButton, usePalette } from "@aulora/ui-native";
import { View } from "react-native";

export interface CallControlsProps {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly canSpeak?: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  /** Offer picture-in-picture (there is video to float and the device can). */
  readonly pipSupported?: boolean;
  readonly onToggleMute: () => void;
  readonly onToggleDeafen: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleScreen: () => void;
  readonly onPip?: () => void;
  readonly onLeave: () => void;
}

function controlIcon(name: Parameters<typeof Icon>[0]["name"], color: string) {
  return <Icon name={name} size={20} color={color} />;
}

function CoreControls({
  muted,
  deafened,
  canSpeak,
  onToggleMute,
  onToggleDeafen,
  onLeave,
}: {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly canSpeak: boolean;
  readonly onToggleMute: () => void;
  readonly onToggleDeafen: () => void;
  readonly onLeave: () => void;
}) {
  const palette = usePalette();
  return (
    <>
      <IconButton
        label={muted ? "Unmute microphone" : "Mute microphone"}
        variant={muted ? "danger" : "secondary"}
        disabled={!canSpeak}
        onPress={onToggleMute}
      >
        {controlIcon(muted ? "mic-off" : "mic", muted ? palette["on-accent"] : palette.text)}
      </IconButton>
      <IconButton
        label={deafened ? "Undeafen" : "Deafen"}
        variant={deafened ? "danger" : "secondary"}
        onPress={onToggleDeafen}
      >
        {controlIcon(
          deafened ? "headphones-off" : "headphones",
          deafened ? palette["on-accent"] : palette.text,
        )}
      </IconButton>
      <IconButton label="Leave call" variant="danger" onPress={onLeave}>
        {controlIcon("phone-off", palette["on-accent"])}
      </IconButton>
    </>
  );
}

function MediaControls(props: {
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  readonly onToggleCamera: () => void;
  readonly onToggleScreen: () => void;
  readonly onPip: (() => void) | undefined;
}) {
  const { video, sharingScreen, canVideo, canStream, onToggleCamera, onToggleScreen, onPip } =
    props;
  const palette = usePalette();
  return (
    <>
      {canVideo && (
        <IconButton
          label={video ? "Turn camera off" : "Turn camera on"}
          variant={video ? "primary" : "secondary"}
          onPress={onToggleCamera}
        >
          {controlIcon(video ? "video" : "video-off", video ? palette["on-accent"] : palette.text)}
        </IconButton>
      )}
      {canStream && (
        <IconButton
          label={sharingScreen ? "Stop sharing screen" : "Share screen"}
          variant={sharingScreen ? "primary" : "secondary"}
          onPress={onToggleScreen}
        >
          {controlIcon(
            sharingScreen ? "monitor-off" : "monitor",
            sharingScreen ? palette["on-accent"] : palette.text,
          )}
        </IconButton>
      )}
      {onPip !== undefined && (
        <IconButton label="Picture in picture" variant="secondary" onPress={onPip}>
          {controlIcon("pip", palette.text)}
        </IconButton>
      )}
    </>
  );
}

/**
 * The pinned in-call control bar: mic, deafen, camera, screen share, optional
 * picture-in-picture and leave.
 */
export function CallControls(props: CallControlsProps) {
  const {
    muted,
    deafened,
    video,
    sharingScreen,
    canSpeak = true,
    canVideo,
    canStream,
    pipSupported = false,
    onToggleMute,
    onToggleDeafen,
    onToggleCamera,
    onToggleScreen,
    onPip,
    onLeave,
  } = props;
  return (
    <View className="flex-row items-center justify-center gap-3 rounded-card border border-border bg-surface-2 px-4 py-3">
      <CoreControls
        muted={muted}
        deafened={deafened}
        canSpeak={canSpeak}
        onToggleMute={onToggleMute}
        onToggleDeafen={onToggleDeafen}
        onLeave={onLeave}
      />
      <MediaControls
        video={video}
        sharingScreen={sharingScreen}
        canVideo={canVideo}
        canStream={canStream}
        onToggleCamera={onToggleCamera}
        onToggleScreen={onToggleScreen}
        onPip={pipSupported ? onPip : undefined}
      />
    </View>
  );
}
