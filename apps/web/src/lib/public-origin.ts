/**
 * The origin to put in links people share.
 *
 * On the web the app is served from the workspace's own origin, so the page
 * origin is right. The desktop shell instead serves the SPA from
 * `tauri://localhost` (macOS/Linux) or `http://tauri.localhost` (Windows):
 * invite links, webhook URLs and channel links built from the page origin there
 * point at the shell and are dead for everyone else. Inside the shell the origin
 * therefore comes from the active workspace's base URL, recorded by
 * `ProfileProvider`.
 */

import { isDesktop } from "./desktop";

/** Origin of the active workspace, recorded by `ProfileProvider`. */
let activeServerOrigin: string | null = null;

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

/** Records the active workspace's base URL; `undefined` clears it. */
export function setActiveServerBaseUrl(baseUrl: string | undefined): void {
  activeServerOrigin = baseUrl === undefined ? null : originOf(baseUrl);
}

/**
 * The origin shared links should use: the active workspace's inside the desktop
 * shell (never the shell's own origin), the page origin in a browser. Empty when
 * the shell has no active workspace yet, so callers build no misleading URL.
 */
export function publicOrigin(): string {
  if (!isDesktop()) {
    return typeof window === "undefined" ? "" : window.location.origin;
  }
  return activeServerOrigin ?? "";
}
