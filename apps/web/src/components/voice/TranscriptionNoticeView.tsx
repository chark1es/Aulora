import { cn, Icon } from "@aulora/ui-web";
import type { TranscriptionClientState } from "../../lib/transcription/client-state";
import { TranscriptionIndicator } from "./TranscriptionIndicator";

/** The sentence that tells everyone in the call what transcription means for them. */
export function transcriptionNoticeText(state: TranscriptionClientState): {
  readonly title: string;
  readonly body: string;
  readonly tone: "info" | "warn";
} {
  const { stream } = state;
  if (stream.kind === "error") {
    return {
      title: "This call is being transcribed",
      body: `${stream.message} Others can still be transcribed.`,
      tone: "warn",
    };
  }
  if (state.optedOut) {
    return {
      title: "This call is being transcribed",
      body: "You opted out. Your own speech is not sent or transcribed.",
      tone: "info",
    };
  }
  if (state.phase === "notice") {
    return {
      title: "This call is being transcribed",
      body: "Your speech will be transcribed in a moment. Opt out to keep your audio out of it.",
      tone: "info",
    };
  }
  if (stream.kind === "reconnecting") {
    return {
      title: "This call is being transcribed",
      body: "Reconnecting to the transcriber. Your speech is not captured meanwhile.",
      tone: "warn",
    };
  }
  return {
    title: "This call is being transcribed",
    body: "Your speech is transcribed while your microphone is on. Mute, or opt out, to stop.",
    tone: "info",
  };
}

export interface TranscriptionNoticeViewProps {
  readonly state: TranscriptionClientState;
  readonly onOptOutChange: (optedOut: boolean) => void;
  /** Takes the stream back after another tab or device replaced this one. */
  readonly onResume?: () => void;
  readonly compact?: boolean;
  readonly className?: string;
}

/**
 * The notice every participant sees while their call is transcribed, guests
 * included, with the opt-out for their own audio. Presentational: the member
 * call UI and the guest page feed it the same client state.
 */
export function TranscriptionNoticeView({
  state,
  onOptOutChange,
  onResume,
  compact = false,
  className,
}: TranscriptionNoticeViewProps) {
  if (state.sessionId === null) {
    return null;
  }
  const text = transcriptionNoticeText(state);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="transcription-notice"
      className={cn(
        "flex items-center gap-2.5 rounded-[8px] border",
        text.tone === "warn" ? "border-idle/30 bg-idle/10" : "border-border bg-surface-2",
        compact ? "px-2 py-1.5" : "px-3 py-2",
        className,
      )}
    >
      <TranscriptionIndicator />
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium text-text", compact ? "text-[11px]" : "text-[12px]")}>
          {text.title}
        </p>
        {!compact && <p className="text-[11px] leading-snug text-text-muted">{text.body}</p>}
        {compact && <span className="sr-only">{text.body}</span>}
      </div>
      {onResume !== undefined &&
        state.stream.kind === "error" &&
        state.stream.resumable === true && (
          <button
            type="button"
            onClick={onResume}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-border px-2 font-medium text-text transition hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              compact ? "h-6 text-[11px]" : "h-7 text-[12px]",
            )}
          >
            Resume
          </button>
        )}
      <button
        type="button"
        aria-pressed={state.optedOut}
        onClick={() => {
          onOptOutChange(!state.optedOut);
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-border px-2 font-medium text-text transition hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          compact ? "h-6 text-[11px]" : "h-7 text-[12px]",
        )}
      >
        <Icon name={state.optedOut ? "mic" : "mic-off"} size={compact ? 12 : 13} />
        {state.optedOut ? "Include my audio" : "Opt out"}
      </button>
    </div>
  );
}
