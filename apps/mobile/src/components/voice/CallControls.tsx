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
  readonly pipPinned?: boolean;
  readonly onToggleMute: () => void;
  readonly onToggleDeafen: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleScreen: () => void;
  readonly onTogglePin?: () => void;
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
  readonly pipPinned: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  readonly onToggleCamera: () => void;
  readonly onToggleScreen: () => void;
  readonly onTogglePin: (() => void) | undefined;
}) {
  const {
    video,
    sharingScreen,
    pipPinned,
    canVideo,
    canStream,
    onToggleCamera,
    onToggleScreen,
    onTogglePin,
  } = props;
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
      {onTogglePin !== undefined && (
        <IconButton
          label={pipPinned ? "Unpin picture-in-picture" : "Pin picture-in-picture"}
          variant={pipPinned ? "primary" : "secondary"}
          onPress={onTogglePin}
        >
          {controlIcon("pip", pipPinned ? palette["on-accent"] : palette.text)}
        </IconButton>
      )}
    </>
  );
}

/**
 * The pinned in-call control bar: mic, deafen, camera, screen share, optional
 * picture-in-picture pin and leave.
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
    pipPinned = false,
    onToggleMute,
    onToggleDeafen,
    onToggleCamera,
    onToggleScreen,
    onTogglePin,
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
        pipPinned={pipPinned}
        canVideo={canVideo}
        canStream={canStream}
        onToggleCamera={onToggleCamera}
        onToggleScreen={onToggleScreen}
        onTogglePin={onTogglePin}
      />
    </View>
  );
}
