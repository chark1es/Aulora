import { cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";
import type { CallIdentity } from "./identity";

/** The header button that floats the call; absent where the platform has no picture-in-picture. */
export function PictureInPictureButton({ identity }: { readonly identity: CallIdentity }) {
  const { pip } = useVoice();
  if (pip.mode === "none") {
    return null;
  }
  const label = pip.active ? "Close picture in picture" : "Picture in picture";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pip.active}
      onClick={() => {
        pip.toggle(identity.nameOf);
      }}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[8px] transition",
        pip.active
          ? "bg-accent/15 text-accent"
          : "text-text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      <Icon name="pip" size={16} />
    </button>
  );
}
