import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  isDesktop,
  listenDesktopEvent,
  parseDeepLink,
  takeDesktopDeepLinks,
} from "../lib/desktop";

/**
 * Runs inside the router so deep links and native menu commands can navigate.
 * A no-op on the web: nothing is registered unless the Tauri shell is present.
 */
export function DesktopBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    document.documentElement.dataset.desktop = "tauri";
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const route = (urls: readonly string[]) => {
      for (const raw of urls) {
        const target = parseDeepLink(raw);
        if (target === null) {
          continue;
        }
        if (target.kind === "connect") {
          void navigate({ to: "/connect", search: { server: target.server } });
        } else {
          void navigate({ to: "/invite/$code", params: { code: target.code } });
        }
      }
    };

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
      const combined = () => {
        offDeepLink();
        offQuickSwitcher();
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
    };
  }, [navigate]);

  return null;
}
