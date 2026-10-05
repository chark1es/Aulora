import type { IconName } from "@aulora/tokens";
import { cn, Icon } from "@aulora/ui-web";
import type { ReactNode } from "react";

export interface CallControlsProps {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  /** Mic and deafen controls are only offered to members who may speak. */
  readonly canSpeak?: boolean;
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

interface ControlSpec {
  readonly key: string;
  readonly label: string;
  readonly active: boolean;
  readonly tone: "neutral" | "accent" | "danger";
  readonly icon: IconName;
  readonly onClick: () => void;
}

function controlSpecs(input: {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly canSpeak: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  readonly onToggleMute: () => void;
  readonly onToggleDeafen: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleScreen: () => void;
  readonly onToggleView: (() => void) | undefined;
  readonly viewExpanded: boolean | undefined;
  readonly onPopOut: (() => void) | undefined;
}): ControlSpec[] {
  const specs: ControlSpec[] = [];
  if (input.canSpeak) {
    specs.push({
      key: "mute",
      label: input.muted ? "Unmute" : "Mute",
      active: !input.muted,
      tone: input.muted ? "danger" : "neutral",
      icon: input.muted ? "mic-off" : "mic",
      onClick: input.onToggleMute,
    });
    specs.push({
      key: "deafen",
      label: input.deafened ? "Undeafen" : "Deafen",
      active: !input.deafened,
      tone: input.deafened ? "danger" : "neutral",
      icon: input.deafened ? "headphones-off" : "headphones",
      onClick: input.onToggleDeafen,
    });
  }
  if (input.canVideo) {
    specs.push({
      key: "camera",
      label: input.video ? "Turn off camera" : "Turn on camera",
      active: input.video,
      tone: input.video ? "accent" : "neutral",
      icon: input.video ? "video" : "video-off",
      onClick: input.onToggleCamera,
    });
  }
  if (input.canStream) {
    specs.push({
      key: "screen",
      label: input.sharingScreen ? "Stop sharing" : "Share screen",
      active: input.sharingScreen,
      tone: input.sharingScreen ? "accent" : "neutral",
      icon: input.sharingScreen ? "monitor-off" : "monitor",
      onClick: input.onToggleScreen,
    });
  }
  if (input.onToggleView !== undefined) {
    specs.push({
      key: "view",
      label: input.viewExpanded === true ? "Minimize call" : "Expand call",
      active: false,
      tone: "neutral",
      icon: input.viewExpanded === true ? "chevron-down" : "expand",
      onClick: input.onToggleView,
    });
  }
  if (input.onPopOut !== undefined) {
    specs.push({
      key: "popout",
      label: "Pop out call",
      active: false,
      tone: "neutral",
      icon: "pip",
      onClick: input.onPopOut,
    });
  }
  return specs;
}

/**
 * The in-call control bar. Colour is meaningful: a red-tinted control is
 * switched off (muted, deafened), accent means actively broadcasting (camera,
 * screen), and the leave button is the only solid danger surface.
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
    onToggleMute,
    onToggleDeafen,
    onToggleCamera,
    onToggleScreen,
    onLeave,
    onToggleView,
    viewExpanded,
    onPopOut,
    compact = false,
  } = props;
  const size = compact ? "h-9 w-9" : "h-11 w-11";
  const icon = compact ? 18 : 21;
  const controls = controlSpecs({
    muted,
    deafened,
    video,
    sharingScreen,
    canSpeak,
    canVideo,
    canStream,
    onToggleMute,
    onToggleDeafen,
    onToggleCamera,
    onToggleScreen,
    onToggleView,
    viewExpanded,
    onPopOut,
  });
  return (
    <div className={cn("flex items-center justify-center gap-1.5", compact ? "gap-1" : "gap-1.5")}>
      {controls.map((control) => (
        <CallButton
          key={control.key}
          label={control.label}
          active={control.active}
          tone={control.tone}
          size={size}
          onClick={control.onClick}
        >
          <Icon name={control.icon} size={icon} />
        </CallButton>
      ))}

      <CallButton label="Leave call" active tone="danger-solid" size={size} onClick={onLeave}>
        <Icon name="phone-hangup" size={icon} />
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
          ? "bg-danger text-on-accent hover:brightness-110"
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
