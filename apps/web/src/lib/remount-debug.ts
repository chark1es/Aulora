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
 *
 * This module is the always-loaded half: the flag check and the log wrappers.
 * The logging code itself ({@link ./remount-debug-log}) is only imported once
 * the flag is on, so ordinary sessions never download diagnostics.
 */

import type { ConvexReactClient } from "convex/react";
import { useEffect } from "react";

const DEBUG_FLAG = "aulora.debug.remount";

/** The auth fields worth logging when the session gate re-evaluates. */
export interface RemountAuthState {
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
}

type RemountLogModule = typeof import("./remount-debug-log");

function loadLog(): Promise<RemountLogModule> {
  return import("./remount-debug-log");
}

/** Logs mount and unmount of one session surface so remount cycles are visible. */
export function useRemountLog(surface: string): void {
  useEffect(() => {
    if (!remountDebugEnabled()) {
      return undefined;
    }
    let log: ((event: string) => void) | undefined;
    let active = true;
    void loadLog().then((module) => {
      if (!active) {
        return;
      }
      module.logRemountEvent(surface, "mount");
      log = (event) => module.logRemountEvent(surface, event);
    });
    return () => {
      active = false;
      log?.("unmount");
    };
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
  void loadLog().then((module) => module.logBoot(surface));
}

/**
 * Logs every Convex connection state change: connected/disconnected, the
 * lifetime connect count and failed retries. A count that grows on a fixed
 * cadence points at a websocket idle timeout in front of the backend.
 */
export function useConvexConnectionLog(client: ConvexReactClient): void {
  useEffect(() => {
    if (!remountDebugEnabled()) {
      return undefined;
    }
    let unsubscribe: (() => void) | undefined;
    let active = true;
    void loadLog().then((module) => {
      if (!active) {
        return;
      }
      unsubscribe = module.subscribeConnectionState(client);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client]);
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
  void loadLog().then((module) => module.logRemountEvent(surface, event, detail));
}

/** Logs a change of the Convex auth state, which decides whether the shell stays. */
export function logAuthState(state: RemountAuthState): void {
  if (!remountDebugEnabled()) {
    return;
  }
  void loadLog().then((module) => module.logAuthState(state));
}
