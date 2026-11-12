import { CALL_ALONE_HINT_MESSAGE, callAloneRemainingMs, formatAloneCountdown } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import { useVoice } from "../../providers/VoiceProvider";

/**
 * The last-minute warning shown while this device is the only participant of a
 * call. The server owns the deadline (`aloneDeadline`), so the countdown
 * survives a reconnect and only appears when a disconnect is actually close.
 *
 * "Stay" is the explicit way to reset the window. Ordinary mute, deafen,
 * camera and screen-share changes deliberately do not, so the rule is easy to
 * predict and a backgrounded client cannot keep an empty call alive.
 */
export function CallAloneNotice({ compact = false }: { readonly compact?: boolean }) {
  const voice = useVoice();
  const deadline = voice.call?.aloneDeadline ?? null;
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

  const remaining = callAloneRemainingMs(deadline, now);
  if (remaining === null) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[8px] border border-accent/30 bg-accent/10",
        compact ? "px-2 py-1 text-[11px]" : "mx-3 mb-1 px-3 py-2 text-[12px]",
      )}
    >
      <Icon name="timer" size={compact ? 12 : 14} className="shrink-0 text-accent-text" />
      {/*
        A visible, polite live region: mounting it announces the static
        sentence once. The ticking countdown inside is aria-hidden so screen
        readers do not read a new number every second.
      */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 flex-1 text-text"
      >
        <span className="sr-only">{CALL_ALONE_HINT_MESSAGE}</span>
        <span aria-hidden="true">
          Leaving in{" "}
          <span className="font-semibold tabular-nums text-accent-text">
            {formatAloneCountdown(remaining)}
          </span>
          {", nobody else is here"}
        </span>
      </span>
      <button
        type="button"
        className="shrink-0 rounded-[6px] px-1.5 py-0.5 font-medium text-accent-text transition hover:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => {
          void voice.stayInCall();
        }}
      >
        Stay
      </button>
    </div>
  );
}
