/**
 * Desktop (Tauri) bridge helpers.
 *
 * The Vite SPA is also the Tauri frontend, so it only uses the Tauri runtime
 * when it is running inside the desktop shell. Every native capability is
 * exposed by the Rust shell as a command (`invoke`) or an event (`listen`). The
 * shell is built with `withGlobalTauri`, so the core API is available as
 * `window.__TAURI__` and the web build carries no Tauri npm dependency.
 */

export type DeepLinkTarget =
  | { readonly kind: "connect"; readonly server: string }
  | { readonly kind: "invite"; readonly code: string };

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriEventApi {
  listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>;
}

interface TauriGlobal {
  core?: { invoke?: TauriInvoke };
  invoke?: TauriInvoke;
  event?: TauriEventApi;
}

function tauri(): TauriGlobal | undefined {
  const candidate = (globalThis as { __TAURI__?: unknown }).__TAURI__;
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  return candidate as TauriGlobal;
}

/** Whether the app is running inside the Tauri desktop shell. */
export function isDesktop(): boolean {
  return tauri() !== undefined;
}

async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const global = tauri();
  const invoke = global?.core?.invoke ?? global?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Aulora desktop bridge: the Tauri invoke bridge is unavailable.");
  }
  return invoke(command, args);
}

/**
 * Subscribes to a shell event. Returns a no-op unsubscribe outside the desktop
 * shell so callers do not need to branch.
 */
export type DesktopPlatform = "macos" | "windows" | "linux";

/**
 * The OS the shell runs on, from the webview's user agent. Only macOS gets a
 * transparent, vibrancy-backed window with overlay traffic lights, so styling
 * that depends on that is scoped with `html[data-platform="macos"]`.
 */
export function desktopPlatform(
  userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): DesktopPlatform {
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    return "macos";
  }
  if (/Windows/i.test(userAgent)) {
    return "windows";
  }
  return "linux";
}

export async function listenDesktopEvent(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  const api = tauri()?.event;
  if (api === undefined || typeof api.listen !== "function") {
    return () => {};
  }
  return api.listen(event, (incoming) => handler(incoming.payload));
}

/**
 * Pulls deep links the shell received before the webview subscribed (e.g. the
 * link that launched the app). Returns an empty list outside the shell.
 */
export async function takeDesktopDeepLinks(): Promise<string[]> {
  if (!isDesktop()) {
    return [];
  }
  try {
    const value = await invokeCommand("take_deep_links");
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Updates the Dock/taskbar unread badge; best-effort outside the shell. */
export async function setDesktopUnreadBadge(count: number): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeCommand("set_unread_badge", { count });
  } catch {
    // The badge is decoration; a missing platform API must never break chat.
  }
}

/**
 * Pins or unpins the window above every other window; best-effort outside the
 * shell. Keeps a pinned call PiP window above other windows.
 */
export async function setDesktopAlwaysOnTop(on: boolean): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeCommand("set_always_on_top", { on });
  } catch {
    // Always-on-top is a nicety; a missing platform API must never break calls.
  }
}

export interface DesktopUpdateStatus {
  readonly updateAvailable: boolean;
  readonly version: string | null;
  readonly currentVersion: string;
  readonly notes: string | null;
  readonly error: string | null;
  readonly source?: "menu" | "auto";
  readonly downloaded?: boolean;
}

export interface DesktopUpdateProgress {
  readonly downloaded: number;
  readonly contentLength: number | null;
}

function isUpdateStatus(value: unknown): value is DesktopUpdateStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.updateAvailable === "boolean" && typeof record.currentVersion === "string";
}

/**
 * Asks the shell whether a signed update is published. Outside the desktop
 * shell this is a no-op so the web client can call it unconditionally.
 */
export async function checkDesktopUpdate(): Promise<DesktopUpdateStatus | null> {
  if (!isDesktop()) {
    return null;
  }
  try {
    const value = await invokeCommand("check_for_app_update");
    if (!isUpdateStatus(value)) {
      return null;
    }
    return {
      updateAvailable: value.updateAvailable,
      version: typeof value.version === "string" ? value.version : null,
      currentVersion: value.currentVersion,
      notes: typeof value.notes === "string" ? value.notes : null,
      error: typeof value.error === "string" ? value.error : null,
      ...(typeof value.downloaded === "boolean" ? { downloaded: value.downloaded } : {}),
    };
  } catch (error) {
    return {
      updateAvailable: false,
      version: null,
      currentVersion: "",
      notes: null,
      error: error instanceof Error ? error.message : "Update check failed.",
    };
  }
}

/** Reads the installed version without needing a successful network check. */
export async function desktopVersion(): Promise<string> {
  const value = await invokeCommand("app_version");
  if (typeof value !== "string") throw new Error("Desktop version is unavailable.");
  return value;
}

/** Downloads and verifies the update without interrupting the app. */
export async function downloadDesktopUpdate(): Promise<void> {
  await invokeCommand("download_app_update");
}

/** Installs the verified download and restarts the shell. */
export async function installDesktopUpdate(): Promise<void> {
  await invokeCommand("install_app_update");
}

/** Shows a native notification with device-computed text; best-effort. */
export async function showDesktopNotification(title: string, body: string): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeCommand("show_notification", { title, body });
  } catch {
    // Notifications are best-effort and never block the message pipeline.
  }
}

/**
 * Parses a deep link into a router target.
 *
 * Accepts both the custom `aulora://` scheme (desktop + native) and https
 * universal links (web), so one parser serves every client:
 *   aulora://connect?server=chat.acme.com
 *   aulora://connect/chat.acme.com
 *   aulora://invite?code=ABCD
 *   aulora://invite/ABCD
 *   https://chat.acme.com/connect?server=chat.acme.com
 *   https://chat.acme.com/invite/ABCD
 */
export function parseDeepLink(raw: string): DeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const isCustom = url.protocol === "aulora:";
  const isHttp = url.protocol === "https:" || url.protocol === "http:";
  if (!isCustom && !isHttp) {
    return null;
  }

  const path = url.pathname.replace(/^\/+/, "");
  const segments = path.length > 0 ? path.split("/").filter((part) => part.length > 0) : [];
  // `aulora://connect/...` puts the action in the hostname; a universal link
  // puts it in the first path segment.
  const action = (
    isCustom
      ? url.hostname.length > 0
        ? url.hostname
        : (segments.shift() ?? "")
      : (segments.shift() ?? "")
  ).toLowerCase();

  if (action === "connect") {
    // `aulora://connect` from the tray/menu carries no server: the connect
    // screen opens empty so the person can type one.
    const server = (url.searchParams.get("server") ?? segments[0] ?? "").trim();
    return { kind: "connect", server };
  }
  if (action === "invite") {
    const code = (url.searchParams.get("code") ?? segments[0] ?? "").trim();
    return code.length > 0 ? { kind: "invite", code } : null;
  }
  return null;
}

export type { TauriGlobal };
