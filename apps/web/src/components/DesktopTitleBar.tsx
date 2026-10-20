import { Text } from "@aulora/ui-web";
import { showsDesktopTitleBar } from "../lib/desktop";
import { useProfiles } from "../providers/ProfileProvider";

/**
 * The dedicated macOS title bar.
 *
 * The macOS shell draws its traffic lights over the webview, so without this
 * they would float on top of the workspace icon and name. This renders a slim
 * full-width strip at the very top of the window, reserves the left edge for
 * the lights, drags the window, and shows the current workspace name centered.
 * The rest of the app is laid out below it by the shell flex column.
 *
 * It renders only in the macOS desktop shell, so the web and the Windows and
 * Linux builds are untouched.
 */
export function DesktopTitleBar() {
  const { activeProfile } = useProfiles();
  if (!showsDesktopTitleBar()) {
    return null;
  }
  return (
    <header className="desktop-titlebar" data-tauri-drag-region>
      <Text as="span" tone="muted" size="xs" className="desktop-titlebar-label">
        {activeProfile?.name ?? "Aulora"}
      </Text>
    </header>
  );
}
