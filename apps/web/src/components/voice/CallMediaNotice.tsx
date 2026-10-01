import { cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";

/**
 * A non-blocking warning shown inside an active call when the microphone or
 * camera could not start (most often an insecure origin, or denied permission).
 * The call still connects and can hear others; this explains the silence.
 */
export function CallMediaNotice({ compact = false }: { readonly compact?: boolean }) {
  const voice = useVoice();
  if (voice.call === null || voice.mediaError === null) {
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
      <Icon name="mic-off" size={compact ? 12 : 14} className="shrink-0" />
      <span className="min-w-0 flex-1">{voice.mediaError}</span>
    </div>
  );
}
