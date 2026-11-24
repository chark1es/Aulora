import { canViewTranscripts } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { lazy, type ReactNode, Suspense } from "react";
import { useLiveTranscriptOpen } from "../../lib/transcription/live-panel-state";
import { useVoice } from "../../providers/VoiceProvider";

// The transcript body (its query, grouping and scrolling) is only fetched once
// someone opens the panel, so calls without it stay as light as before.
const LiveTranscriptPanel = lazy(() => import("./LiveTranscriptSheet"));

/**
 * The session the live transcript can show for the call this device is in, or
 * null when it is off, not transcribing, or this viewer may not read transcripts.
 */
export function useLiveTranscriptSession(): string | null {
  const voice = useVoice();
  const call = voice.call;
  if (
    call === null ||
    call.transcribing !== true ||
    (call.transcriptionSessionId ?? null) === null ||
    !canViewTranscripts(voice.permissions, voice.addons.transcription)
  ) {
    return null;
  }
  return call.transcriptionSessionId ?? null;
}

/** The header toggle. Renders nothing unless a live transcript is available. */
export function LiveTranscriptToggle() {
  const sessionId = useLiveTranscriptSession();
  const [open, setOpen] = useLiveTranscriptOpen();
  if (sessionId === null) {
    return null;
  }
  const label = open ? "Hide live transcript" : "Show live transcript";
  return (
    <button
      type="button"
      aria-label="Live transcript"
      aria-pressed={open}
      title={label}
      onClick={() => {
        setOpen(!open);
      }}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[8px] transition hover:bg-surface-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        open ? "bg-surface-3 text-text" : "text-text-muted",
      )}
    >
      <Icon name="message" size={16} />
    </button>
  );
}

/**
 * The call body: the grid, plus the live transcript to its right on wide
 * screens or as a bottom sheet on narrow ones. The panel only exists (and so
 * only subscribes) while it is open and a live session is available.
 */
export function CallBodyWithTranscript({
  children,
  onOpenFull,
}: {
  readonly children: ReactNode;
  /** Runs before navigating to the full transcript (the stage minimizes itself). */
  readonly onOpenFull?: () => void;
}) {
  const sessionId = useLiveTranscriptSession();
  const [open, setOpen] = useLiveTranscriptOpen();
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 p-3">{children}</div>
      {open && sessionId !== null && (
        <Suspense fallback={null}>
          <LiveTranscriptPanel
            sessionId={sessionId}
            open
            {...(onOpenFull !== undefined ? { onOpenFull } : {})}
            onClose={() => {
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
