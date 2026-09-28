/**
 * Pure presence-heartbeat mapping, kept import-free so it can be unit-tested in
 * a plain Node environment: importing `react-native` there fails to parse. The
 * parameter is a raw string rather than `AppStateStatus` for the same reason.
 */

/**
 * Foreground apps (`active`) heartbeat `online`; anything else
 * (`background`/`inactive`) heartbeats `idle`. On mobile, idle means the app is
 * not in the foreground — the mobile analogue of the web inactivity timer.
 */
export function heartbeatStatusForAppState(state: string): "online" | "idle" {
  return state === "active" ? "online" : "idle";
}
