import { Text } from "@aulora/ui-web";
import { desktopPlatform, isDesktop } from "../lib/desktop";
import { useDesktopUpdates } from "../providers/DesktopUpdateProvider";

/** Brief feedback for native menu checks. Update controls live in user settings. */
export function DesktopUpdateNotice() {
  const { menuNote } = useDesktopUpdates();
  if (!isDesktop() || menuNote === null) return null;
  const top = desktopPlatform() === "macos" ? "top-12" : "top-3";
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3 ${top}`}>
      <div
        className="max-w-xl rounded-input border border-border bg-surface-1 px-3 py-2"
        data-testid="desktop-update-note"
        role="status"
      >
        <Text size="sm">{menuNote}</Text>
      </div>
    </div>
  );
}
