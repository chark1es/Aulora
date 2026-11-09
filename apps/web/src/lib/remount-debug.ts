/**
 * Opt-in diagnostics for the reported "the app refreshes every few minutes"
 * behaviour.
 *
 * A visible reload is either a React remount of one of the session surfaces or
 * a flip of the Convex auth state. Both are cheap to log and impossible to
 * observe after the fact, so they stay behind a flag the owner can switch on in
 * their own browser and leave off for everyone else:
 *
 *   localStorage.setItem("aulora.debug.remount", "1")
 *
 * The flag is read on every log call (not cached at import time), so toggling
 * it in the console takes effect without a reload. Logs include a timestamp and
 * the surface; auth logs include the three `useConvexAuth()` fields.
 */

import type { ConvexReactClient } from "convex/react";
import { useEffect } from "react";

const DEBUG_FLAG = "aulora.debug.remount";
const BOOT_KEY = "aulora.debug.boots";
const PREFIX = "[aulora:remount]";

/** Logs mount and unmount of one session surface so remount cycles are visible. */
export function useRemountLog(surface: string): void {
  useEffect(() => {
    logRemountEvent(surface, "mount");
    return () => logRemountEvent(surface, "unmount");
  }, [surface]);
}

/**
 * The address to log: origin and path only. A boot can happen while an OAuth
 * handoff code, state or error is still in the address bar, and diagnostics
 * must never copy one into the console or a bug report.
 */
export function redactLocationHref(href: string | undefined): string {
  if (href === undefined || href.length === 0) {
    return "";
  }
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Logs once per page boot. A `navigation` type of `reload` (rather than
 * `navigate`) plus a boot count that keeps increasing is a real document
 * reload; a boot count that stays put while surfaces log `mount` is a React
 * remount.
 */
export function logBoot(surface: string): void {
  if (!remountDebugEnabled()) {
    return;
  }
  let boots = 0;
  try {
    const previous = Number(globalThis.sessionStorage?.getItem(BOOT_KEY) ?? "0");
    boots = (Number.isFinite(previous) ? previous : 0) + 1;
    globalThis.sessionStorage?.setItem(BOOT_KEY, String(boots));
  } catch {
    // Session storage can be blocked; the navigation entry still helps.
  }
  const navigation = globalThis.performance?.getEntriesByType?.("navigation").at(0) as
    | PerformanceNavigationTiming
    | undefined;
  // eslint-disable-next-line no-console -- opt-in diagnostics the owner asked for
  console.warn(
    `${PREFIX} ${new Date().toISOString()} ${surface} boot #${String(boots)} navigation=${
      navigation?.type ?? "unknown"
    } visibility=${globalThis.document?.visibilityState ?? "unknown"} href=${redactLocationHref(
      globalThis.location?.href,
    )}`,
  );
}

/**
 * Logs every Convex connection state change: connected/disconnected, the
 * lifetime connect count and failed retries. A count that grows on a fixed
 * cadence points at a websocket idle timeout in front of the backend.
 */
export function useConvexConnectionLog(client: ConvexReactClient): void {
  useEffect(
    () =>
      client.subscribeToConnectionState((state) => {
        logRemountEvent("convex", "connection", {
          connected: state.isWebSocketConnected,
          connectionCount: state.connectionCount,
          connectionRetries: state.connectionRetries,
        });
      }),
    [client],
  );
}

/** Whether the owner has enabled remount diagnostics in this browser. */
export function remountDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEBUG_FLAG) === "1";
  } catch {
    // Storage can be blocked; diagnostics then stay off.
    return false;
  }
}

/** Logs one lifecycle event when the diagnostics flag is on. */
export function logRemountEvent(surface: string, event: string, detail?: unknown): void {
  if (!remountDebugEnabled()) {
    return;
  }
  const at = new Date().toISOString();
  // eslint-disable-next-line no-console -- opt-in diagnostics the owner asked for
  console.warn(`${PREFIX} ${at} ${surface} ${event}`, detail ?? "");
}

/** Logs a change of the Convex auth state, which decides whether the shell stays. */
export function logAuthState(state: {
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
}): void {
  if (!remountDebugEnabled()) {
    return;
  }
  const at = new Date().toISOString();
  // eslint-disable-next-line no-console -- opt-in diagnostics the owner asked for
  console.warn(
    `${PREFIX} ${at} convex.auth isAuthenticated=${String(state.isAuthenticated)} isLoading=${String(
      state.isLoading,
    )} isRefreshing=${String(state.isRefreshing)}`,
  );
}
