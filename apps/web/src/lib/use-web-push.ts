import { useEffect } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { ChatRuntime } from "./chat-runtime";
import { isDesktop } from "./desktop";
import { isWebPushSupported, registerWebPushDevice } from "./web-push";

/**
 * Registers this browser for Web Push once the chat runtime (and therefore the
 * device identity) is ready. No-op on desktop, where notifications go through
 * the native Tauri bridge instead, and on browsers without Push support.
 */
export function useWebPush(runtime: ChatRuntime | undefined): void {
  useEffect(() => {
    if (runtime === undefined || isDesktop() || !isWebPushSupported()) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const config = await runtime.client.query(api.server.publicConfig, {});
        const publicKey = config.webPush?.publicKey ?? null;
        if (publicKey === null || cancelled) {
          return;
        }
        if (Notification.permission === "denied") {
          return;
        }
        if (Notification.permission === "default") {
          const granted = await Notification.requestPermission();
          if (granted !== "granted") {
            return;
          }
        }
        if (cancelled) {
          return;
        }
        await registerWebPushDevice(runtime.client, runtime.identityKey, publicKey);
      } catch {
        // Web Push is best-effort; never surface a registration failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime]);
}
