import { callKindLabel } from "@aulora/core";
import { cn } from "@aulora/ui-web";
import { useCallback, useMemo, useRef, useState } from "react";
import { useVoice } from "../../providers/VoiceProvider";
import { CallCompactView, DOCK_HEIGHT, DOCK_WIDTH } from "./CallCompactView";
import { type CallIdentity, UNKNOWN_IDENTITY } from "./identity";

const POSITION_KEY = "aulora.callDock.v1";

interface DockPosition {
  readonly x: number;
  readonly y: number;
}

function readPosition(): DockPosition | null {
  try {
    const raw = globalThis.localStorage.getItem(POSITION_KEY);
    if (raw === null) {
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
 *  - Can float out of the page as real picture-in-picture (see
 *    `CallPictureInPicture`), which the compact view's PiP button controls.
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
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (voice.pipPinned) {
        return;
      }
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect === undefined) {
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
          globalThis.localStorage.setItem(POSITION_KEY, JSON.stringify(current));
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

  // The dock hides while the call floats out of the page, or when it is hidden
  // or shown full screen.
  if (call === null || voice.view !== "dock" || voice.pip.active) {
    return null;
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
        <CallCompactView
          title={title}
          identity={identity}
          floating={false}
          onHide={() => {
            voice.setView("hidden");
          }}
        />
      </div>
    </section>
  );
}
