import { lazy, Suspense } from "react";
import { isDesktop } from "../lib/desktop";

const DesktopContextMenuPolicy = lazy(() =>
  import("./DesktopContextMenuPolicy").then((module) => ({
    default: module.DesktopContextMenuPolicy,
  })),
);

/**
 * Installs the desktop right-click policy where the Tauri shell is present.
 *
 * The browser build returns nothing, and the policy module (plus the menu
 * renderer it imports) is fetched only inside the shell, so neither is part of
 * the entry chunk.
 */
export function DesktopContextMenu() {
  if (!isDesktop()) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <DesktopContextMenuPolicy />
    </Suspense>
  );
}
