import { useContextMenu } from "@aulora/ui-web";
import { useEffect } from "react";
import {
  copyTextToClipboard,
  currentSelectionText,
  handleContextMenuEvent,
  saveMediaFile,
  selectAllText,
} from "../lib/context-menu-policy";
import { isDesktop, openExternal } from "../lib/desktop";

/**
 * Installs the desktop right-click policy.
 *
 * The browser build keeps its normal native menu, so this mounts a listener
 * only inside the Tauri shell. Surfaces with their own `useContextMenu` handler
 * are unaffected: the policy suppresses the webview's menu without stopping
 * propagation, and component handlers still open their menus.
 *
 * Loaded on demand by {@link ./DesktopContextMenu}; the policy and the menu
 * renderer it needs are not part of the entry chunk.
 */
export function DesktopContextMenuPolicy({
  onOpenDebugLogs,
}: {
  readonly onOpenDebugLogs?: () => void;
}) {
  const openMenu = useContextMenu();

  useEffect(() => {
    if (!isDesktop()) {
      return undefined;
    }
    const onContextMenu = (event: MouseEvent) => {
      const debugItems = onOpenDebugLogs
        ? [
            {
              id: "debug-logs",
              label: "Debug logs",
              onSelect: onOpenDebugLogs,
              separatorBefore: true,
            },
          ]
        : [];
      const decision = handleContextMenuEvent(event, {
        dev: import.meta.env.DEV,
        selectionText: currentSelectionText,
        openMenu: (menu) => {
          openMenu({ ...menu, items: [...menu.items, ...debugItems] });
        },
        copyText: (text) => {
          void copyTextToClipboard(text);
        },
        openExternal,
        saveMedia: saveMediaFile,
        selectAll: selectAllText,
      });
      if (decision.action === "suppress" && debugItems.length > 0) {
        openMenu({
          clientX: event.clientX,
          clientY: event.clientY,
          label: "Aulora",
          items: debugItems,
        });
      }
    };
    // Capture phase: cancel the webview menu before it can open. Component
    // handlers still run for suppressed surfaces (we never stop propagation
    // there), so app menus are untouched.
    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    return () => {
      window.removeEventListener("contextmenu", onContextMenu, { capture: true });
    };
  }, [openMenu, onOpenDebugLogs]);

  return null;
}
