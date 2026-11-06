/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { callKindLabel } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useEffect, useState } from "react";
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
} from "../../lib/desktop";
import { PersonAvatar } from "../chat/member-avatars";
import { CallControls } from "./CallControls";
import { useCallDuration } from "./hooks";

/**
 * The shell's call picture-in-picture window.
 *
 * A separate webview with its own entry (`#pip`), so it renders on its own: the
 * call itself — peer connections and media — stays in the main window, which
 * streams what is happening over Tauri events and runs whatever is pressed here.
 * Nothing in this window plays audio and nothing asks for a device; the call's
 * audio keeps coming from the main window.
 *
 * The header is the drag region, so the window can be dragged anywhere on any
 * screen. Closing it only closes this window: the call and the app carry on.
 */
export function CallPipWindow() {
  const state = usePipCallState();
  const duration = useCallDuration(state?.startedAt ?? null);
  const participants = state?.participants ?? [];
  const columns = participants.length <= 1 ? 1 : 2;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
      <header
        data-tauri-drag-region="deep"
        className="flex shrink-0 select-none items-center gap-2 border-b border-border px-2.5 py-2"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-soft text-accent">
          <Icon name={state?.kind === "video" ? "video" : "volume"} size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {state === null ? "Aulora" : callKindLabel(state.kind)}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{duration}</span>
        <button
          type="button"
          aria-label="Close the call window"
          title="Close the call window — the call continues"
          onClick={() => {
            // Back to the app, with the call still running there.
            void focusDesktopMainWindow();
            void closeDesktopPipWindow();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="x" size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {state === null ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-text-muted">
            Waiting for the call…
          </div>
        ) : (
          // Rows share the window's height so a small call still fills it, and
          // grow past it — the column scrolls — once there are more people
          // than fit.
          <div
            className="grid gap-1.5"
            style={{
              minHeight: "100%",
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
        )}
      </div>

      {state !== null && (
        <div className="shrink-0 border-t border-border px-2 py-2">
          <CallControls
            compact
            muted={state.muted}
            deafened={state.deafened}
            video={state.camera}
            sharingScreen={state.screen}
            canSpeak={state.canSpeak}
            canVideo={state.canVideo}
            canStream={state.canStream}
            onToggleMute={() => sendPipAction("toggle-mute")}
            onToggleDeafen={() => sendPipAction("toggle-deafen")}
            onToggleCamera={() => sendPipAction("toggle-camera")}
            onToggleScreen={() => sendPipAction("toggle-screen")}
            onLeave={() => sendPipAction("leave")}
          />
        </div>
      )}
    </div>
  );
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
