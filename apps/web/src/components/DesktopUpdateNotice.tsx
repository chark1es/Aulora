import { Text } from "@aulora/ui-web";
import { isDesktop } from "../lib/desktop";
import { useDesktopUpdates } from "../providers/DesktopUpdateProvider";
import { ClientUpdateBanner } from "./ClientUpdateBanner";

/**
 * Root-mounted shell for desktop-update chrome. The banner is available on
 * every route (signed in or not); the note is brief feedback for native menu
 * checks.
 */
export function DesktopUpdateNotice() {
  return (
    <>
      <ClientUpdateBanner />
      <MenuUpdateNote />
    </>
  );
}

function MenuUpdateNote() {
  const { menuNote } = useDesktopUpdates();
  if (!isDesktop() || menuNote === null) return null;
  return (
    <div className="desktop-titlebar-offset pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3">
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
