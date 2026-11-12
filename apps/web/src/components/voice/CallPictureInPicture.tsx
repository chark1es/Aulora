import { createPortal } from "react-dom";
import { useVoice } from "../../providers/VoiceProvider";
import { CallCompactView } from "./CallCompactView";
import type { CallIdentity } from "./identity";

/**
 * Draws the call into the browser’s Document Picture-in-Picture window.
 *
 * The desktop shell’s call window is a separate webview with its own entry
 * (`CallPipWindow`), not a portal, so only browsers reach this. Mounted next to
 * the dock so the window survives moving between views; renders nothing
 * otherwise (the floating-video fallback draws itself).
 */
export function CallPictureInPicture({
  title,
  identity,
}: {
  readonly title: string;
  readonly identity: CallIdentity;
}) {
  const voice = useVoice();
  const pipWindow = voice.pipSurface.window;
  if (voice.call === null || pipWindow === null) {
    return null;
  }
  return createPortal(
    <div className="h-screen">
      <CallCompactView title={title} identity={identity} floating />
    </div>,
    pipWindow.document.body,
  );
}
