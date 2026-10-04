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

/**
 * The pinned in-call control bar: mic, deafen, camera, screen share, optional
 * picture-in-picture pin and leave.
 */
export function CallControls({
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
}: CallControlsProps) {
  const palette = usePalette();
  const icon = (name: Parameters<typeof Icon>[0]["name"], color: string) => (
    <Icon name={name} size={20} color={color} />
  );
  return (
    <View className="flex-row items-center justify-center gap-3 rounded-card border border-border bg-surface-2 px-4 py-3">
      <IconButton
        label={muted ? "Unmute microphone" : "Mute microphone"}
        variant={muted ? "danger" : "secondary"}
        disabled={!canSpeak}
        onPress={onToggleMute}
      >
        {icon(muted ? "mic-off" : "mic", muted ? palette["on-accent"] : palette.text)}
      </IconButton>
      <IconButton
        label={deafened ? "Undeafen" : "Deafen"}
        variant={deafened ? "danger" : "secondary"}
        onPress={onToggleDeafen}
      >
        {icon(
          deafened ? "headphones-off" : "headphones",
          deafened ? palette["on-accent"] : palette.text,
        )}
      </IconButton>
      {canVideo && (
        <IconButton
          label={video ? "Turn camera off" : "Turn camera on"}
          variant={video ? "primary" : "secondary"}
          onPress={onToggleCamera}
        >
          {icon(video ? "video" : "video-off", video ? palette["on-accent"] : palette.text)}
        </IconButton>
      )}
      {canStream && (
        <IconButton
          label={sharingScreen ? "Stop sharing screen" : "Share screen"}
          variant={sharingScreen ? "primary" : "secondary"}
          onPress={onToggleScreen}
        >
          {icon(
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
          {icon("pip", pipPinned ? palette["on-accent"] : palette.text)}
        </IconButton>
      )}
      <IconButton label="Leave call" variant="danger" onPress={onLeave}>
        {icon("phone-off", palette["on-accent"])}
      </IconButton>
    </View>
  );
}
