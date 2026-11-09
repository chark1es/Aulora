import { Modal, useContextMenu } from "@aulora/ui-web";
import { useCallback, useEffect, useState } from "react";
import { currentSelectionText, decideContextMenu } from "../lib/context-menu-policy";
import { isDesktop } from "../lib/desktop";
import { DebugLogsSection } from "./chat/DebugLogsSection";
import { DesktopContextMenu } from "./DesktopContextMenu";

/** Local diagnostics must remain reachable on connect/sign-in screens. */
export function DebugLogsAccess() {
  const [open, setOpen] = useState(false);
  const openMenu = useContextMenu();
  const showLogs = useCallback(() => setOpen(true), []);
  useEffect(() => {
    if (isDesktop()) return;
    const onContextMenu = (event: MouseEvent) => {
      const decision = decideContextMenu(event, {
        dev: import.meta.env.DEV,
        selectionText: currentSelectionText(),
      });
      // Keep browser editing, link, media, selection and app-specific menus.
      if (decision.action !== "suppress") return;
      event.preventDefault();
      openMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        label: "Aulora",
        items: [{ id: "debug-logs", label: "Debug logs", onSelect: showLogs }],
      });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, [openMenu, showLogs]);
  return (
    <>
      <DesktopContextMenu onOpenDebugLogs={showLogs} />
      <Modal open={open} onClose={() => setOpen(false)} label="Debug logs" size="lg">
        {open && <DebugLogsSection />}
      </Modal>
    </>
  );
}
