import { callKindLabel } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { desktopPlatform, isDesktop } from "../../lib/desktop";
import { useVoice } from "../../providers/VoiceProvider";
import { CallControls } from "./CallControls";
import { CallMediaNotice } from "./CallMediaNotice";
import { CallGrid } from "./CallParticipant";
import { useCallDuration } from "./hooks";
import type { CallIdentity } from "./identity";

export const DOCK_WIDTH = 340;
export const DOCK_HEIGHT = 232;

/**
 * The small call window: who is in the call, the controls, and a few buttons.
 * Used for the in-page dock and for both kinds of picture-in-picture (the
 * browser's floating window and the desktop app's shrunken window).
 */
export function CallCompactView({
  title,
  identity,
  floating,
  onHide,
}: {
  readonly title: string;
  readonly identity: CallIdentity;
  /** Drawn in a picture-in-picture surface that fills its window. */
  readonly floating: boolean;
  /** Present for the in-page dock, which can be hidden. */
  readonly onHide?: (() => void) | undefined;
}) {
  const voice = useVoice();
  const duration = useCallDuration(voice.call?.startedAt ?? null);
  const call = voice.call;
  if (call === null) {
    return null;
  }
  // The macOS window has its traffic lights over the top-left corner.
  const clearTrafficLights = floating && isDesktop() && desktopPlatform() === "macos";
  return (
    <div className="flex flex-col gap-2 p-2" style={{ height: floating ? "100vh" : DOCK_HEIGHT }}>
      <div className={cn("flex items-center gap-2 px-0.5", clearTrafficLights && "pl-[68px]")}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-soft text-accent">
          <Icon name={call.kind === "video" ? "video" : "volume"} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text">
          {title}
          <span className="sr-only"> ({callKindLabel(call.kind)})</span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{duration}</span>
        <CompactButtons identity={identity} floating={floating} onHide={onHide} />
      </div>

      <div className="min-h-0 flex-1">
        <CallGrid
          participants={call.participants}
          streams={voice.remoteStreams}
          screens={voice.remoteScreens}
          localUserId={voice.selfUserId}
          localVideoTrack={voice.localVideoTrack}
          settings={voice.settings}
          identity={identity}
          speakingIds={voice.remoteSpeaking}
          localSpeaking={voice.localSpeaking}
          className="h-full"
        />
      </div>

      <CallMediaNotice compact />

      <div className="flex items-center justify-center pb-0.5">
        <CompactControls />
      </div>
    </div>
  );
}

function CompactControls() {
  const voice = useVoice();
  return (
    <CallControls
      compact
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
  );
}

/** The header buttons, which differ between the dock and a floating window. */
function CompactButtons({
  identity,
  floating,
  onHide,
}: {
  readonly identity: CallIdentity;
  readonly floating: boolean;
  readonly onHide: (() => void) | undefined;
}) {
  const voice = useVoice();
  const { pip } = voice;
  // The browser's own floating window is already above everything, so only the
  // in-page dock and the desktop window have anything to pin.
  const canPin = !floating || pip.mode === "window";
  const pinLabel =
    pip.mode === "window"
      ? voice.pipPinned
        ? "Stop keeping on top"
        : "Keep on top of other windows"
      : voice.pipPinned
        ? "Unpin from top"
        : "Pin to top";
  return (
    <>
      {canPin && (
        <IconButton
          label={pinLabel}
          active={voice.pipPinned}
          onClick={() => {
            voice.setPipPinned(!voice.pipPinned);
          }}
        >
          <Icon name="pin" size={13} />
        </IconButton>
      )}
      {pip.mode !== "none" && (
        <IconButton
          label={pip.active ? "Close picture in picture" : "Picture in picture"}
          active={pip.active}
          onClick={() => {
            pip.toggle(identity.nameOf);
          }}
        >
          <Icon name="pip" size={13} />
        </IconButton>
      )}
      <IconButton
        label="Expand to full view"
        onClick={() => {
          if (pip.active) {
            pip.toggle(identity.nameOf);
          }
          voice.setView("stage");
        }}
      >
        <Icon name="expand" size={13} />
      </IconButton>
      {onHide !== undefined && (
        <IconButton label="Hide call window" onClick={onHide}>
          <Icon name="x" size={13} />
        </IconButton>
      )}
    </>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
