import { useEffect } from "react";
import type { ChatRuntime } from "./chat-runtime";

/** How long the tab can sit untouched before presence reads as `idle`. */
export const IDLE_AFTER_MS = 5 * 60_000;

/** How often the heartbeat is sent while the tab stays open. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** User input closer together than this does not refresh activity again. */
const ACTIVITY_THROTTLE_MS = 5_000;

export interface ComputeActivityStatusInput {
  /** Whether `document.hidden` is set (tab in the background). */
  readonly hidden: boolean;
  /** Current wall-clock time in milliseconds. */
  readonly now: number;
  /** The last time the user interacted with the tab, in milliseconds. */
  readonly lastActive: number;
  /** Idle threshold in milliseconds. */
  readonly idleAfterMs: number;
}

/**
 * Pure activity decision: a hidden tab, or one untouched for longer than
 * `idleAfterMs`, is idle; otherwise the user is online. Kept side-effect free
 * so it can be unit-tested without a DOM.
 */
export function computeActivityStatus(input: ComputeActivityStatusInput): "online" | "idle" {
  const { hidden, now, lastActive, idleAfterMs } = input;
  if (hidden) {
    return "idle";
  }
  return now - lastActive > idleAfterMs ? "idle" : "online";
}

/**
 * Keeps this browser's presence fresh while the runtime is alive. Sends an
 * immediate `online` heartbeat on mount, then refreshes every 30s (or right
 * after the tab becomes active again). The tab is reported `idle` when hidden
 * or left untouched. Only heartbeats: a status the user set manually is
 * preserved by the server and never touched here.
 */
export function usePresenceHeartbeat(runtime: ChatRuntime | undefined): void {
  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const { port } = runtime;
    let lastActive = Date.now();
    let hidden = typeof document === "undefined" ? false : document.hidden;
    let lastStatus: "online" | "idle" = "online";
    let lastMoveAt = 0;

    const send = (status: "online" | "idle") => {
      lastStatus = status;
      void port.heartbeat({ status }).catch(() => undefined);
    };

    send("online");

    const markActive = () => {
      lastActive = Date.now();
      if (!hidden && lastStatus === "idle") {
        send("online");
      }
    };

    const onPointer = () => markActive();
    const onKey = () => markActive();
    const onTouch = () => markActive();
    const onFocus = () => markActive();
    const onMove = () => {
      const now = Date.now();
      if (now - lastMoveAt < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastMoveAt = now;
      markActive();
    };
    const onVisibility = () => {
      hidden = document.hidden;
      if (!hidden) {
        lastActive = Date.now();
        send("online");
      }
    };

    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onTouch);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const timer = setInterval(() => {
      const status = computeActivityStatus({
        hidden,
        now: Date.now(),
        lastActive,
        idleAfterMs: IDLE_AFTER_MS,
      });
      send(status);
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [runtime]);
}
