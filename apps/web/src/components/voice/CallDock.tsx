import { callKindLabel } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setDesktopAlwaysOnTop } from "../../lib/desktop";
import { openDocumentPip } from "../../lib/voice/pip";
import { useVoice } from "../../providers/VoiceProvider";
import { CallControls } from "./CallControls";
import { CallMediaNotice } from "./CallMediaNotice";
import { CallGrid } from "./CallParticipant";
import { useCallDuration } from "./hooks";
import { type CallIdentity, UNKNOWN_IDENTITY } from "./identity";

const POSITION_KEY = "aulora.callDock.v1";
const DOCK_WIDTH = 340;
const DOCK_HEIGHT = 232;

interface DockPosition {
  readonly x: number;
  readonly y: number;
}

function readPosition(): DockPosition | null {
  try {
    const raw = globalThis.localStorage?.getItem(POSITION_KEY);
    if (raw === null || raw === undefined) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DockPosition>;
    return typeof parsed.x === "number" && typeof parsed.y === "number"
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

/**
 * The floating call window (picture-in-picture).
 *
 *  - Draggable anywhere, with the position remembered across sessions.
 *  - Pinnable to the top of the window; on desktop the shell is also asked to
 *    keep the whole window above other apps' windows.
 *  - Poppable into a real OS-level Document Picture-in-Picture window, where the
 *    same UI is portalled so it survives switching apps.
 */
export function CallDock({
  title,
  identity = UNKNOWN_IDENTITY,
}: {
  readonly title: string;
  readonly identity?: CallIdentity;
}) {
  const voice = useVoice();
  const [position, setPosition] = useState<DockPosition | null>(readPosition);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // Keep the OS window above others while the call is pinned.
  useEffect(() => {
    void setDesktopAlwaysOnTop(voice.pipPinned);
    return () => {
      void setDesktopAlwaysOnTop(false);
    };
  }, [voice.pipPinned]);

  const popOut = useCallback(async () => {
    const window = await openDocumentPip(DOCK_WIDTH + 40, DOCK_HEIGHT + 40);
    if (window !== null) {
      window.addEventListener("pagehide", () => setPipWindow(null));
      setPipWindow(window);
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (voice.pipPinned) {
        return;
      }
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect === undefined || rect === null) {
        return;
      }
      dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [voice.pipPinned],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    const x = Math.max(
      8,
      Math.min(window.innerWidth - DOCK_WIDTH - 8, event.clientX - drag.offsetX),
    );
    const y = Math.max(
      8,
      Math.min(window.innerHeight - DOCK_HEIGHT - 8, event.clientY - drag.offsetY),
    );
    setPosition({ x, y });
  }, []);

  const onPointerUp = useCallback(() => {
    if (dragRef.current === null) {
      return;
    }
    dragRef.current = null;
    setPosition((current) => {
      if (current !== null) {
        try {
          globalThis.localStorage?.setItem(POSITION_KEY, JSON.stringify(current));
        } catch {
          // Position is a nicety.
        }
      }
      return current;
    });
  }, []);

  const style = useMemo<React.CSSProperties>(() => {
    if (voice.pipPinned) {
      return { left: "50%", top: 12, transform: "translateX(-50%)", width: DOCK_WIDTH };
    }
    const fallback: DockPosition = {
      x: Math.max(8, window.innerWidth - DOCK_WIDTH - 20),
      y: Math.max(8, window.innerHeight - DOCK_HEIGHT - 20),
    };
    const anchor = position ?? fallback;
    return { left: anchor.x, top: anchor.y, width: DOCK_WIDTH };
  }, [position, voice.pipPinned]);

  const call = voice.call;

  const body = (
    <DockBody
      title={title}
      identity={identity}
      pipMode={pipWindow !== null}
      onPopOut={pipWindow === null ? () => void popOut() : undefined}
      onClose={() => voice.setView("hidden")}
    />
  );

  if (call === null || voice.view !== "dock") {
    return null;
  }

  if (pipWindow !== null) {
    return createPortal(body, pipWindow.document.body);
  }

  return (
    <section
      ref={panelRef}
      style={style}
      className={cn(
        "fixed z-[70] overflow-hidden rounded-card border border-border bg-surface-1 shadow-2xl shadow-black/40",
        voice.pipPinned && "ring-1 ring-accent/40",
      )}
      aria-label={`${callKindLabel(call.kind)} in ${title}`}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn("select-none", !voice.pipPinned && "cursor-grab active:cursor-grabbing")}
      >
        {body}
      </div>
    </section>
  );
}

function DockBody({
  title,
  identity,
  pipMode,
  onPopOut,
  onClose,
}: {
  readonly title: string;
  readonly identity: CallIdentity;
  readonly pipMode: boolean;
  readonly onPopOut?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const voice = useVoice();
  const duration = useCallDuration(voice.call?.startedAt ?? null);
  const call = voice.call;
  if (call === null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 p-2" style={{ height: pipMode ? "100vh" : DOCK_HEIGHT }}>
      <div className="flex items-center gap-2 px-0.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-accent-soft text-accent">
          <Icon name={call.kind === "video" ? "video" : "volume"} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text">{title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{duration}</span>
        <DockIconButton
          label={voice.pipPinned ? "Unpin from top" : "Pin to top"}
          active={voice.pipPinned}
          onClick={() => voice.setPipPinned(!voice.pipPinned)}
        >
          <Icon name="pin" size={13} />
        </DockIconButton>
        <DockIconButton label="Expand to full view" onClick={() => voice.setView("stage")}>
          <Icon name="expand" size={13} />
        </DockIconButton>
        {onPopOut !== undefined && (
          <DockIconButton label="Pop out call" onClick={onPopOut}>
            <Icon name="pip" size={13} />
          </DockIconButton>
        )}
        <DockIconButton label="Hide call window" onClick={onClose}>
          <Icon name="x" size={13} />
        </DockIconButton>
      </div>

      <div className="min-h-0 flex-1">
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

      <CallMediaNotice compact />

      <div className="flex items-center justify-center pb-0.5">
        <CallControls
          compact
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
      </div>
    </div>
  );
}

function DockIconButton({
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
