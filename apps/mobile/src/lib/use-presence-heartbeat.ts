import type { ChatPort } from "@aulora/core";
import { useEffect } from "react";
import { AppState } from "react-native";
import { heartbeatStatusForAppState } from "./presence-heartbeat";

export { heartbeatStatusForAppState };

/** How often the heartbeat is refreshed while the app stays mounted. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Keeps this device's presence fresh while the runtime is alive. Heartbeats
 * `online` on mount and whenever the app returns to the foreground, `idle` when
 * it leaves (mobile idle = app not in the foreground, the analogue of the web
 * inactivity timer), and refreshes the current app-state status every 30s. Only
 * heartbeats: a deliberately chosen status is preserved by the server.
 */
export function usePresenceHeartbeat(port: ChatPort | undefined): void {
  useEffect(() => {
    if (port === undefined) {
      return;
    }
    let current = AppState.currentState;
    const send = (status: "online" | "idle") => {
      void port.heartbeat({ status }).catch(() => undefined);
    };

    send(heartbeatStatusForAppState(current));

    const subscription = AppState.addEventListener("change", (next) => {
      current = next;
      send(heartbeatStatusForAppState(next));
    });
    const timer = setInterval(() => {
      send(heartbeatStatusForAppState(current));
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [port]);
}
