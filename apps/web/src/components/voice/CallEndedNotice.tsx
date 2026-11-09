import { callAloneTimeoutLabel } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useEffect } from "react";
import { useVoice } from "../../providers/VoiceProvider";

/** How long the disconnect notice stays before it fades out on its own. */
const NOTICE_TIMEOUT_MS = 12_000;

/**
 * A non-blocking notice after the server disconnected this device for being
 * alone in a call. It is deliberately outside the call surfaces: the call UI is
 * already gone by the time it appears, and the person may still be in another
 * conversation. A close button and a timed dismissal keep it out of the way.
 */
export function CallEndedNotice() {
  const voice = useVoice();
  const notice = voice.endedNotice;
  const dismiss = voice.dismissEndedNotice;

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(dismiss, NOTICE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice, dismiss]);

  if (notice === null) {
    return null;
  }

  return (
    <div className="desktop-titlebar-offset pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-3">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-auto flex w-[min(420px,calc(100vw-24px))] items-start gap-2.5 rounded-card border border-border bg-surface-1 px-3 py-2.5 text-[12px] text-text shadow-2xl shadow-black/40",
          "motion-safe:animate-slide-up",
        )}
      >
        <Icon name="timer" size={15} className="mt-px shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          You were disconnected because you were alone in the call for{" "}
          {callAloneTimeoutLabel(notice.timeoutSeconds)}.
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          className="mt-px shrink-0 rounded-[6px] p-0.5 text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={dismiss}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  );
}
