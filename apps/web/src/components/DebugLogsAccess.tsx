import { useContextMenu } from "@aulora/ui-web";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { elementFromTarget, isEditableTarget } from "../lib/context-menu-target";
import { isDesktop } from "../lib/desktop";

import { DesktopContextMenu } from "./DesktopContextMenu";

const DebugLogsDialog = lazy(() => import("./DebugLogsDialog"));

/** Local diagnostics must remain reachable on connect/sign-in screens. */
export function DebugLogsAccess() {
  const [open, setOpen] = useState(false);
  const openMenu = useContextMenu();
  const showLogs = useCallback(() => {
    setOpen(true);
  }, []);
  useEffect(() => {
    if (isDesktop()) return;
    const onContextMenu = (event: MouseEvent) => {
      // Shift+right-click and keyboard context menus retain the native menu.
      if (event.defaultPrevented || event.shiftKey || event.button !== 2) return;
      const element = elementFromTarget(event.target);
      if (
        isEditableTarget(element) ||
        (element?.closest("a[href], [data-context-menu-media]") ?? null) !== null ||
        (window.getSelection()?.toString().length ?? 0) > 0
      )
        return;
      event.preventDefault();
      openMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        label: "Aulora",
        items: [{ id: "debug-logs", label: "Debug logs", onSelect: showLogs }],
      });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [openMenu, showLogs]);
  return (
    <>
      <DesktopContextMenu onOpenDebugLogs={showLogs} />
      {open && (
        <Suspense fallback={null}>
          <DebugLogsDialog
            onClose={() => {
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
