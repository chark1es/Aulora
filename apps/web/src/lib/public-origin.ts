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
 *
 * `ProfileProvider` records that URL in an effect after mount, so early in a
 * desktop session the origin is still unknown. Callers must then build no link
 * at all ({@link publicUrl} returns `null`) instead of a bare path that only
 * looks like one.
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

/**
 * {@link publicOrigin} as `null` instead of an empty string, for the props and
 * callbacks that have to hide or disable sharing while it is unknown.
 */
export function publicOriginOrNull(): string | null {
  const origin = publicOrigin();
  return origin.length > 0 ? origin : null;
}

/**
 * An absolute URL other people can open for `path`, or `null` when the origin
 * is not known yet. A bare path must never be copied or shown as a link: inside
 * the shell it is a relative fragment of the bundle, not a workspace address.
 */
export function publicUrl(path: string): string | null {
  const origin = publicOriginOrNull();
  if (origin === null) {
    return null;
  }
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * The URL an OAuth provider sends the browser back to.
 *
 * The desktop client is the webview, so an in-app round trip has to land in the
 * webview's own origin (`tauri://localhost` / `http://tauri.localhost`). That
 * origin is a Tauri implementation detail: it is never rendered, copied or put
 * in a shared link, and this is the only place in the client that names it. See
 * `apps/desktop/README.md` for the two sign-in paths.
 */
export function authCallbackUrl(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}
