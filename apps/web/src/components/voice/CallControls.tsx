import type { IconName } from "@aulora/tokens";
import { cn, Icon } from "@aulora/ui-web";
import type { ReactNode } from "react";

export interface CallControlsProps {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  readonly onToggleMute: () => void;
  readonly onToggleDeafen: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleScreen: () => void;
  readonly onLeave: () => void;
  /** Minimize/expand control (dock <-> stage). */
  readonly onToggleView?: () => void;
  readonly viewExpanded?: boolean;
  /** Pop the call into a real OS picture-in-picture window. */
  readonly onPopOut?: () => void;
  readonly compact?: boolean;
}

/**
 * The in-call control bar. Colour is meaningful: a red-tinted control is
 * switched off (muted, deafened), accent means actively broadcasting (camera,
 * screen), and the leave button is the only solid danger surface.
 */
export function CallControls({
  muted,
  deafened,
  video,
  sharingScreen,
  canVideo,
  canStream,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onToggleScreen,
  onLeave,
  onToggleView,
  viewExpanded,
  onPopOut,
  compact = false,
}: CallControlsProps) {
  const size = compact ? "h-9 w-9" : "h-11 w-11";
  const icon = compact ? 16 : 19;
  return (
    <div className={cn("flex items-center justify-center gap-1.5", compact ? "gap-1" : "gap-1.5")}>
      <CallButton
        label={muted ? "Unmute" : "Mute"}
        active={!muted}
        tone={muted ? "danger" : "neutral"}
        size={size}
        onClick={onToggleMute}
      >
        <Icon name={muted ? "mic-off" : "mic"} size={icon} />
      </CallButton>

      <CallButton
        label={deafened ? "Undeafen" : "Deafen"}
        active={!deafened}
        tone={deafened ? "danger" : "neutral"}
        size={size}
        onClick={onToggleDeafen}
      >
        <Icon name={deafened ? "headphones-off" : "headphones"} size={icon} />
      </CallButton>

      {canVideo && (
        <CallButton
          label={video ? "Turn off camera" : "Turn on camera"}
          active={video}
          tone={video ? "accent" : "neutral"}
          size={size}
          onClick={onToggleCamera}
        >
          <Icon name={video ? "video" : "video-off"} size={icon} />
        </CallButton>
      )}

      {canStream && (
        <CallButton
          label={sharingScreen ? "Stop sharing" : "Share screen"}
          active={sharingScreen}
          tone={sharingScreen ? "accent" : "neutral"}
          size={size}
          onClick={onToggleScreen}
        >
          <Icon name={sharingScreen ? "monitor-off" : "monitor"} size={icon} />
        </CallButton>
      )}

      {onToggleView !== undefined && (
        <CallButton
          label={viewExpanded === true ? "Minimize call" : "Expand call"}
          active={false}
          tone="neutral"
          size={size}
          onClick={onToggleView}
        >
          <Icon name={viewExpanded === true ? "chevron-down" : "expand"} size={icon} />
        </CallButton>
      )}

      {onPopOut !== undefined && (
        <CallButton
          label="Pop out call"
          active={false}
          tone="neutral"
          size={size}
          onClick={onPopOut}
        >
          <Icon name="pip" size={icon} />
        </CallButton>
      )}

      <CallButton label="Leave call" active tone="danger-solid" size={size} onClick={onLeave}>
        <Icon name="phone-off" size={icon} />
      </CallButton>
    </div>
  );
}

function CallButton({
  label,
  onClick,
  children,
  active,
  tone,
  size,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly active: boolean;
  readonly tone: "neutral" | "accent" | "danger" | "danger-solid";
  readonly size: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={tone === "neutral" ? undefined : active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95",
        size,
        tone === "danger-solid"
          ? "bg-danger text-white hover:brightness-110"
          : tone === "danger"
            ? "bg-danger/15 text-danger hover:bg-danger/25"
            : tone === "accent"
              ? "bg-accent/15 text-accent hover:bg-accent/25"
              : "bg-surface-3 text-text hover:brightness-110",
      )}
    >
      {children}
    </button>
  );
}

export type { IconName };
