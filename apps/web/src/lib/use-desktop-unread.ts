import { useEffect } from "react";
import { isDesktop, setDesktopUnreadBadge } from "./desktop";

interface AppBadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/**
 * Mirrors an unread total into the desktop Dock/taskbar badge and the OS app
 * badge (`navigator.setAppBadge`) where supported.
 *
 * The total is summed from the sidebar's live `readStates.summary` rows
 * (`unreadCount`), which already scan each channel's read cursor and tail. This
 * hook used to subscribe `notifications.unreadSummary` as well, so every
 * message insert re-ran two independent per-channel tail scans per client.
 * `unreadSummary` stays in the backend for installed clients.
 */
export function useUnreadBadge(total: number): number {
  const desktop = isDesktop();

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
