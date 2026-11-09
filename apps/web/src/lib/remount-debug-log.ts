/**
 * The diagnostics themselves, loaded on demand by {@link ./remount-debug} only
 * when `aulora.debug.remount` is set. Keeping it separate is what lets the flag
 * check stay in the entry chunk without shipping the logging code.
 */

import type { ConvexReactClient } from "convex/react";
import { type RemountAuthState, redactLocationHref, remountDebugEnabled } from "./remount-debug";

const BOOT_KEY = "aulora.debug.boots";
const PREFIX = "[aulora:remount]";

/** Counts this document boot and logs its navigation type and visibility. */
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
export function logAuthState(state: RemountAuthState): void {
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

/** Logs every Convex connection state change; returns the unsubscribe. */
export function subscribeConnectionState(client: ConvexReactClient): () => void {
  return client.subscribeToConnectionState((state) => {
    logRemountEvent("convex", "connection", {
      connected: state.isWebSocketConnected,
      connectionCount: state.connectionCount,
      connectionRetries: state.connectionRetries,
    });
  });
}
