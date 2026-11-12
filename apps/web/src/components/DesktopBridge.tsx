/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */

import { notifyAuthChanged, notifyAuthError } from "@aulora/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import {
  desktopPlatform,
  isDesktop,
  listenDesktopEvent,
  parseDeepLink,
  takeDesktopDeepLinks,
} from "../lib/desktop";
import { useDesktopShortcuts } from "../lib/use-desktop-shortcuts";
import { useProfiles } from "../providers/ProfileProvider";

type RouteDeepLinks = (urls: readonly string[]) => void;

/**
 * Wires the shell’s deep links, quick switcher and sidebar events into the
 * page. Only runs inside the Tauri shell; shared by the bridge below.
 */
function useDesktopEvents(route: RouteDeepLinks): void {
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    document.documentElement.dataset.desktop = "tauri";
    document.documentElement.dataset.platform = desktopPlatform();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const register = async () => {
      // Links that launched the app are buffered by the shell; drain them first.
      route(await takeDesktopDeepLinks());
      const offDeepLink = await listenDesktopEvent("aulora://deep-link", (payload) => {
        const urls = Array.isArray(payload)
          ? payload.filter((entry): entry is string => typeof entry === "string")
          : [];
        route(urls);
      });
      const offQuickSwitcher = await listenDesktopEvent("aulora://quick-switcher", () => {
        window.dispatchEvent(new Event("aulora:quick-switcher"));
      });
      const offToggleSidebar = await listenDesktopEvent("aulora://toggle-sidebar", () => {
        window.dispatchEvent(new Event("aulora:toggle-sidebar"));
      });
      const combined = () => {
        offDeepLink();
        offQuickSwitcher();
        offToggleSidebar();
      };
      if (disposed) {
        combined();
      } else {
        unlisten = combined;
      }
    };

    void register();
    return () => {
      disposed = true;
      unlisten?.();
      delete document.documentElement.dataset.desktop;
      delete document.documentElement.dataset.platform;
    };
  }, [route]);
}

/**
 * Runs inside the router so deep links and native menu commands can navigate.
 * A no-op on the web: nothing is registered unless the Tauri shell is present.
 */
export function DesktopBridge() {
  const navigate = useNavigate();
  const { activeProfile } = useProfiles();

  const route = useCallback<RouteDeepLinks>(
    (urls) => {
      for (const raw of urls) {
        const target = parseDeepLink(raw);
        if (target === null) {
          continue;
        }
        if (target.kind === "connect") {
          void navigate({ to: "/connect", search: { server: target.server } });
        } else if (target.kind === "auth") {
          void (async () => {
            // The OAuth exchange is only needed for a deep link that carries a
            // finished sign-in, so it stays out of the entry chunk.
            const { completeDesktopAuthDeepLink } = await import("../lib/oauth-start");
            const signedIn = await completeDesktopAuthDeepLink(
              target.code,
              target.server,
              target.tx,
            );
            if (signedIn) {
              // The token is stored; let the mounted session gate refetch
              // instead of reloading and discarding the current view.
              notifyAuthChanged();
            }
          })();
        } else if (target.kind === "auth-error") {
          // Store the allowlisted error only when it names this tab’s pending
          // workspace and transaction; a stray link cannot cancel a real
          // sign-in or paint a message into it. Notify an already-mounted form
          // so it shows the message without waiting for a remount.
          void (async () => {
            const { completeDesktopAuthErrorDeepLink } = await import("../lib/oauth-start");
            const shown = await completeDesktopAuthErrorDeepLink(
              target.error,
              target.server,
              target.tx,
              Date.now(),
              activeProfile?.siteUrl,
            );
            if (shown) {
              notifyAuthError();
            }
          })();
        } else {
          void navigate({ to: "/invite/$code", params: { code: target.code } });
        }
      }
    },
    [navigate, activeProfile?.siteUrl],
  );

  // Ctrl+N on Windows/Linux takes the same route as the native menu item.
  const connect = useCallback(() => {
    route(["aulora://connect"]);
  }, [route]);

  useDesktopShortcuts({ onConnect: connect });
  useDesktopEvents(route);

  return null;
}
