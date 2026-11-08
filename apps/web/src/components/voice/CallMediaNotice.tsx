import { cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";

/**
 * A non-blocking warning shown inside an active call.
 *
 * Two kinds share the strip: a microphone or camera that could not start (most
 * often an insecure origin, or denied permission; the call still connects and
 * can hear others), and an automatic quality reduction (the camera bitrate was
 * lowered, or the camera was turned off) which the person can undo or dismiss.
 */
export function CallMediaNotice({ compact = false }: { readonly compact?: boolean }) {
  const voice = useVoice();
  const quality = voice.qualityNotice;
  if (voice.call === null) {
    return null;
  }
  if (quality === null && voice.mediaError === null) {
    return null;
  }
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-[8px] border border-idle/30 bg-idle/10 text-idle",
        compact ? "px-2 py-1 text-[11px]" : "mx-3 mt-2 px-3 py-2 text-[12px]",
      )}
    >
      <Icon
        name={quality !== null ? "signal" : "mic-off"}
        size={compact ? 12 : 14}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">{quality ?? voice.mediaError}</span>
      {quality === null ? null : (
        <>
          <button
            type="button"
            className="shrink-0 rounded-[6px] px-1.5 py-0.5 font-medium hover:bg-idle/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => {
              voice.undoQualityChange();
            }}
          >
            Undo
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded-[6px] p-0.5 hover:bg-idle/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => {
              voice.dismissQualityNotice();
            }}
          >
            <Icon name="x" size={compact ? 12 : 14} />
          </button>
        </>
      )}
    </div>
  );
}
