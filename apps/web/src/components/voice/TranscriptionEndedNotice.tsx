import { canViewTranscripts } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestOpenTranscript } from "../../lib/transcription/transcript-navigation";
import { nextTranscriptionEnd } from "../../lib/transcription/transcription-end";
import { useVoice } from "../../providers/VoiceProvider";

/** How long the notice stays before it fades out on its own. */
const NOTICE_TIMEOUT_MS = 15_000;

/**
 * A non-blocking toast when the transcription of the call this device is in
 * ends, with a shortcut to the finished transcript. Like `CallEndedNotice` it
 * lives outside the call surfaces, because the call UI may already be gone.
 */
export function TranscriptionEndedNotice() {
  const voice = useVoice();
  const allowed = canViewTranscripts(voice.permissions, voice.addons.transcription);
  const trackedRef = useRef<string | null>(null);
  const shownRef = useRef<Set<string>>(new Set());
  const [ended, setEnded] = useState<string | null>(null);

  const call = voice.call;
  const transcribing = call?.transcribing === true;
  const sessionId = call?.transcriptionSessionId ?? null;
  const inCall = call !== null;

  useEffect(() => {
    const step = nextTranscriptionEnd(
      trackedRef.current,
      inCall ? { transcribing, sessionId } : null,
    );
    trackedRef.current = step.tracked;
    if (step.ended !== null && !shownRef.current.has(step.ended)) {
      shownRef.current.add(step.ended);
      setEnded(step.ended);
    }
  }, [inCall, transcribing, sessionId]);

  const dismiss = useCallback(() => {
    setEnded(null);
  }, []);

  if (ended === null || !allowed) {
    return null;
  }
  return (
    <EndedToast
      key={ended}
      // The solo-call notice uses the same slot; sit below it when both show.
      stacked={voice.endedNotice !== null}
      onDismiss={dismiss}
      onView={() => {
        requestOpenTranscript(ended);
        dismiss();
      }}
    />
  );
}

export function EndedToast({
  onView,
  onDismiss,
  stacked = false,
}: {
  readonly onView: () => void;
  readonly onDismiss: () => void;
  readonly stacked?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) {
      return;
    }
    const timer = setTimeout(onDismiss, NOTICE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [paused, onDismiss]);

  return (
    <div
      className={cn(
        "desktop-titlebar-offset pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-3",
        stacked && "mt-16",
      )}
    >
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => {
          setPaused(true);
        }}
        onMouseLeave={() => {
          setPaused(false);
        }}
        onFocus={() => {
          setPaused(true);
        }}
        onBlur={() => {
          setPaused(false);
        }}
        className={cn(
          "pointer-events-auto flex w-[min(420px,calc(100vw-24px))] items-center gap-2.5 rounded-card border border-border bg-surface-1 px-3 py-2.5 text-[12px] text-text shadow-2xl shadow-black/40",
          "motion-safe:animate-slide-up",
        )}
      >
        <Icon name="message" size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 font-medium">Transcription ended</span>
        <button
          type="button"
          className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-medium text-accent-text transition hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onView}
        >
          View transcript
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          className="shrink-0 rounded-[6px] p-0.5 text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onDismiss}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  );
}
