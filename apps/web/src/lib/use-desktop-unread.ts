import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { isDesktop, setDesktopUnreadBadge } from "./desktop";

interface AppBadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/**
 * Streams the server-computed unread total into the desktop Dock/taskbar badge
 * and the OS app badge (`navigator.setAppBadge`) where supported. Unlike the
 * old arrival counter, this reflects the real per-channel read cursors, so it
 * stays correct across devices and after a reload.
 */
export function useLiveUnreadBadge(): number {
  const desktop = isDesktop();
  const summary = useQuery(api.notifications.unreadSummary, desktop ? {} : "skip");
  const total = summary?.total ?? 0;

  useEffect(() => {
    if (!desktop) {
      return;
    }
    void setDesktopUnreadBadge(total);
  }, [desktop, total]);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }
    const badge = navigator as unknown as AppBadgeNavigator;
    if (typeof badge.setAppBadge !== "function") {
      return;
    }
    void badge.setAppBadge(total);
  }, [total]);

  return total;
}
