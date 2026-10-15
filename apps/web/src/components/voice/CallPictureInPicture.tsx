import { createPortal } from "react-dom";
import { useVoice } from "../../providers/VoiceProvider";
import { CallCompactView } from "./CallCompactView";
import type { CallIdentity } from "./identity";

/**
 * Draws the call into whichever floating surface is open: the browser's
 * Document Picture-in-Picture window, or the desktop window once it has shrunk
 * to a small one. Mounted next to the dock so the window survives moving between
 * views; renders nothing otherwise (the floating-video fallback draws itself).
 */
export function CallPictureInPicture({
  title,
  identity,
}: {
  readonly title: string;
  readonly identity: CallIdentity;
}) {
  const voice = useVoice();
  const { window: pipWindow, mini } = voice.pipSurface;
  if (voice.call === null) {
    return null;
  }
  if (pipWindow !== null) {
    return createPortal(
      <CallCompactView title={title} identity={identity} floating />,
      pipWindow.document.body,
    );
  }
  if (mini) {
    return createPortal(
      <div className="fixed inset-0 z-[120] bg-bg">
        <CallCompactView title={title} identity={identity} floating />
      </div>,
      document.body,
    );
  }
  return null;
}
