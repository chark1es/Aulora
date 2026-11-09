/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { callAloneRemainingMs, callKindLabel, formatAloneCountdown } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useEffect, useRef, useState } from "react";
import {
  MAIN_WINDOW_LABEL,
  PIP_ACTION_EVENT,
  PIP_STATE_EVENT,
  type PipAction,
  type PipCallState,
  type PipParticipant,
  parsePipState,
} from "../../lib/call-pip";
import {
  closeDesktopPipWindow,
  emitDesktopEventTo,
  focusDesktopMainWindow,
  listenDesktopEvent,
  type PipResizeDirection,
  snapDesktopPipWindow,
  startDesktopResize,
} from "../../lib/desktop";
import { PersonAvatar } from "../chat/member-avatars";
import { CallControls } from "./CallControls";
import { useCallDuration } from "./hooks";
import { TranscriptionIndicator } from "./TranscriptionIndicator";
import { usePipMedia } from "./use-pip-media";

/** The undecorated window's own edge handles: (direction, placement, cursor). */
const RESIZE_HANDLES: ReadonlyArray<{
  readonly direction: PipResizeDirection;
  readonly className: string;
}> = [
  { direction: "North", className: "left-2 right-2 top-0 h-1.5 cursor-ns-resize" },
  { direction: "South", className: "bottom-0 left-2 right-2 h-1.5 cursor-ns-resize" },
  { direction: "West", className: "bottom-2 left-0 top-2 w-1.5 cursor-ew-resize" },
  { direction: "East", className: "bottom-2 right-0 top-2 w-1.5 cursor-ew-resize" },
  { direction: "NorthWest", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize" },
  { direction: "NorthEast", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize" },
];

/**
 * Ticks once a second while a solo-call deadline is set, so the tiny window can
 * show the same last-minute warning as the main call surface.
 */
function useDeadlineTick(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [deadline]);
  return now;
}

/**
 * The shell's call picture-in-picture window.
 *
 * A separate webview with its own entry (`#pip`), so it renders on its own: the
 * call itself — peer connections and media — stays in the main window, which
 * sends the picture over a loopback peer connection (or, where that cannot
 * work, as JPEG frames) and runs whatever is pressed here. Nothing in this
 * window plays audio and nothing asks for a device; the call's audio keeps
 * coming from the main window.
 *
 * The header is the drag region and the eight thin edges resize the window, so
 * the undecorated window behaves like a native one. The controls only appear on
 * hover; otherwise the surface is just the picture. Double-clicking the picture
 * (or the close button) returns to the app with the call still running.
 */
export function CallPipWindow() {
  const state = usePipCallState();
  const duration = useCallDuration(state?.startedAt ?? null);
  const aloneRemaining = callAloneRemainingMs(
    state?.aloneDeadline ?? null,
    useDeadlineTick(state?.aloneDeadline ?? null),
  );
  const media = usePipMedia();
  const mediaArea = useRef<HTMLDivElement | null>(null);
  const participants = state?.participants ?? [];
  const columns = participants.length <= 1 ? 1 : 2;

  // Double-clicking the picture goes back to the app. A native listener rather
  // than a JSX handler: the surface is not a control, and the close button is
  // its keyboard-reachable equivalent.
  useEffect(() => {
    const node = mediaArea.current;
    if (node === null) {
      return;
    }
    const onDoubleClick = () => {
      returnToApp();
    };
    node.addEventListener("dblclick", onDoubleClick);
    return () => {
      node.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  return (
    <div className="group relative flex h-full flex-col overflow-hidden bg-bg text-text">
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.direction}
          aria-hidden="true"
          data-pip-resize={handle.direction}
          onPointerDown={(event) => {
            event.preventDefault();
            void startDesktopResize(handle.direction);
          }}
          className={cn("absolute z-20", handle.className)}
        />
      ))}

      <header
        data-tauri-drag-region="deep"
        onPointerUp={() => {
          // The shell also snaps after its own drag debounce; this covers the
          // case where the webview sees the drop first.
          void snapDesktopPipWindow();
        }}
        className="flex shrink-0 select-none items-center gap-2 border-b border-border px-2.5 py-2"
      >
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {state === null ? "Aulora" : callKindLabel(state.kind)}
        </span>
        {state?.transcribing === true && <TranscriptionIndicator />}
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{duration}</span>
        <button
          type="button"
          aria-label="Close the call window"
          title="Close the call window — the call continues"
          onClick={() => {
            returnToApp();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="x" size={13} />
        </button>
      </header>

      <div
        ref={mediaArea}
        className="relative min-h-0 flex-1"
        title="Double-click to return to the app"
      >
        {/* The live picture. Always mounted so the track has a sink the moment
            it arrives; it is only shown when it is the active surface. */}
        <video
          ref={media.videoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            "absolute inset-0 h-full w-full bg-black object-contain",
            media.kind !== "loopback" && "hidden",
          )}
        />
        <canvas
          ref={media.canvasRef}
          width={480}
          height={270}
          className={cn(
            "absolute inset-0 h-full w-full bg-black object-contain",
            media.kind !== "frames" && "hidden",
          )}
        />

        {state === null ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-text-muted">
            Waiting for the call…
          </div>
        ) : (
          media.kind === "none" && (
            // No picture: the same participant tiles the window always drew.
            <div
              className="grid h-full gap-1.5 overflow-y-auto p-2"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: "minmax(min-content, 1fr)",
              }}
            >
              {participants.map((participant) => (
                <PipTile
                  key={participant.id}
                  participant={participant}
                  avatarSize={participants.length <= 1 ? 56 : 36}
                />
              ))}
            </div>
          )
        )}

        {state !== null && media.kind !== "none" && state.speakerName !== "" && (
          <span className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
            {state.mediaKind === "screen" && <Icon name="monitor" size={10} />}
            {state.mediaKind === "camera" && <Icon name="video" size={10} />}
            {state.mediaKind === "local" && <Icon name="users" size={10} />}
            <span className="truncate">{state.speakerName}</span>
          </span>
        )}

        {state !== null && aloneRemaining !== null && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            <Icon name="timer" size={10} className="text-accent" />
            <span className="tabular-nums">{formatAloneCountdown(aloneRemaining)}</span>
            <button
              type="button"
              onClick={() => {
                sendPipAction("stay");
              }}
              className="rounded-full px-1 font-semibold text-accent transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Stay
            </button>
          </div>
        )}

        {state !== null && (
          // A clean picture until the pointer arrives.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
            <div className="pointer-events-auto">
              <CallControls
                compact
                muted={state.muted}
                deafened={state.deafened}
                video={state.camera}
                sharingScreen={state.screen}
                canSpeak={state.canSpeak}
                canVideo={state.canVideo}
                canStream={state.canStream}
                onToggleMute={() => {
                  sendPipAction("toggle-mute");
                }}
                onToggleDeafen={() => {
                  sendPipAction("toggle-deafen");
                }}
                onToggleCamera={() => {
                  sendPipAction("toggle-camera");
                }}
                onToggleScreen={() => {
                  sendPipAction("toggle-screen");
                }}
                onLeave={() => {
                  sendPipAction("leave");
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Back to the app, with the call still running there. */
function returnToApp(): void {
  void focusDesktopMainWindow();
  void closeDesktopPipWindow();
}

/** Sends one control press to the main window, which owns the call. */
function sendPipAction(action: PipAction): void {
  void emitDesktopEventTo(MAIN_WINDOW_LABEL, PIP_ACTION_EVENT, action);
}

/** One participant: avatar, name, and the state worth knowing at a glance. */
function PipTile({
  participant,
  avatarSize,
}: {
  readonly participant: PipParticipant;
  readonly avatarSize: number;
}) {
  const speaking = participant.speaking && !participant.muted;
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col items-center justify-center gap-1 rounded-card border bg-surface-2 px-1 py-1.5",
        speaking ? "border-secondary/70" : "border-border",
      )}
    >
      <PersonAvatar userId={participant.id} size={avatarSize} />
      <span className="flex min-w-0 max-w-full items-center gap-1">
        {participant.muted && <Icon name="mic-off" size={10} className="text-danger" />}
        {participant.screen && <Icon name="monitor" size={10} className="text-accent" />}
        {participant.camera && !participant.screen && (
          <Icon name="video" size={10} className="text-accent" />
        )}
        <span className="truncate text-[11px] text-text-muted">
          {participant.name}
          {participant.self ? " (you)" : ""}
        </span>
      </span>
      {participant.deafened && (
        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white">
          <Icon name="headphones-off" size={10} />
        </span>
      )}
      {speaking && (
        <span
          aria-hidden="true"
          data-speaking-ring=""
          className="pointer-events-none absolute inset-0 rounded-card ring-2 ring-inset ring-secondary"
        />
      )}
    </div>
  );
}

/**
 * The call snapshot the main window streams, or `null` until the first one
 * arrives. Malformed payloads are ignored rather than drawn.
 */
function usePipCallState(): PipCallState | null {
  const [state, setState] = useState<PipCallState | null>(null);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenDesktopEvent(PIP_STATE_EVENT, (payload) => {
      const next = parsePipState(payload);
      if (next !== null) {
        setState(next);
      }
    }).then((off) => {
      if (disposed) {
        off();
      } else {
        unlisten = off;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return state;
}
