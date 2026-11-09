/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
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
  | { readonly kind: "invite"; readonly code: string }
  | {
      readonly kind: "auth";
      readonly code: string;
      readonly server: string;
      readonly tx?: string | undefined;
    }
  | {
      readonly kind: "auth-error";
      readonly error: string;
      readonly server: string;
      readonly tx?: string | undefined;
    };

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriEventApi {
  listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>;
  /** Present with `withGlobalTauri`; used to reach another window by label. */
  emitTo?(target: string, event: string, payload?: unknown): Promise<void>;
}

/**
 * A shell IPC channel: the streaming half of a command. Its `onmessage` receives
 * JSON values and raw byte payloads (an `ArrayBuffer` for `Raw` responses).
 */
export interface DesktopChannel {
  onmessage: ((message: unknown) => void) | null;
  onerror?: ((error: unknown) => void) | null;
}

interface TauriChannelConstructor {
  new (): DesktopChannel;
}

/** The core `Window` object from `withGlobalTauri`; only what is needed here. */
interface TauriWindowHandle {
  startResizeDragging?(direction: string): Promise<void>;
}

interface TauriWindowApi {
  getCurrentWindow?(): TauriWindowHandle;
}

interface TauriGlobal {
  core?: { invoke?: TauriInvoke; Channel?: TauriChannelConstructor };
  invoke?: TauriInvoke;
  event?: TauriEventApi;
  window?: TauriWindowApi;
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

/**
 * Creates a channel a command can stream into (used for PCM audio). Returns
 * `null` outside the shell, so callers can degrade instead of throwing.
 */
export function createDesktopChannel(): DesktopChannel | null {
  const Channel = tauri()?.core?.Channel;
  if (typeof Channel !== "function") {
    return null;
  }
  return new Channel();
}

/**
 * Runs one shell command. Most capabilities below are wrapped in a typed helper;
 * this is exported for the few (capture) that own their parsing elsewhere.
 */
export async function invokeDesktopCommand(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const global = tauri();
  const invoke = global?.core?.invoke ?? global?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Aulora desktop bridge: the Tauri invoke bridge is unavailable.");
  }
  return invoke(command, args);
}

/**
 * Runs one shell command whose payload is raw bytes (a `tauri::ipc::Request`
 * with an `InvokeBody::Raw` body). Used for video frames, which must not be
 * base64-encoded or JSON-encoded on the way to the shell.
 */
export async function invokeDesktopRaw(command: string, bytes: Uint8Array): Promise<unknown> {
  const global = tauri();
  const invoke = global?.core?.invoke ?? global?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Aulora desktop bridge: the Tauri invoke bridge is unavailable.");
  }
  // The bridge treats an ArrayBuffer view as an octet-stream body.
  return invoke(command, bytes as unknown as Record<string, unknown>);
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

/**
 * Whether the shell needs the dedicated macOS title bar. Only the macOS window
 * draws its traffic lights over the webview, so it is the only platform that
 * has to reserve a strip of its own for them. Windows and Linux keep the native
 * title bar and the web build has none, so both are unchanged.
 */
export function showsDesktopTitleBar(
  desktop: boolean = isDesktop(),
  platform: DesktopPlatform = desktopPlatform(),
): boolean {
  return desktop && platform === "macos";
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
    const value = await invokeDesktopCommand("take_deep_links");
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
    await invokeDesktopCommand("set_unread_badge", { count });
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
    await invokeDesktopCommand("set_always_on_top", { on });
  } catch {
    // Always-on-top is a nicety; a missing platform API must never break calls.
  }
}

/**
 * Toggles the shell window between fullscreen and restored. Only Windows and
 * Linux need this (F11): macOS has the native View > Enter Full Screen item.
 */
export async function toggleDesktopFullscreen(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeDesktopCommand("toggle_fullscreen");
  } catch {
    // Fullscreen is a convenience; a refused toggle must never break the app.
  }
}

/** A corner or edge of the call window a resize handle starts dragging. */
export type PipResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

/**
 * How the shell can float a call on this desktop. Wayland compositors do not
 * let an app keep an always-on-top, undecorated window reliably, so the shell
 * reports `"dock"` there and the in-app call dock stays the floating surface.
 */
export type DesktopPipMode = "window" | "dock";

/** Asks the shell which floating surface it can offer; `"window"` off desktop. */
export async function desktopPipMode(): Promise<DesktopPipMode> {
  if (!isDesktop()) {
    return "window";
  }
  try {
    return (await invokeDesktopCommand("pip_window_mode")) === "dock" ? "dock" : "window";
  } catch {
    return "window";
  }
}

/**
 * Opens the shell's separate call window: a small, always-on-top window the user
 * can drag anywhere on any screen. The main window keeps the call and stays as
 * it is. Resolves `true` when a real window is open, `false` outside the shell,
 * on a compositor that cannot float one, or if the request failed, so callers
 * keep the in-app dock instead.
 */
export async function openDesktopPipWindow(width: number, height: number): Promise<boolean> {
  if (!isDesktop()) {
    return false;
  }
  try {
    return (await invokeDesktopCommand("open_pip_window", { width, height })) !== "dock";
  } catch {
    return false;
  }
}

/** Snaps the call window to the nearest corner or edge of its screen. */
export async function snapDesktopPipWindow(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeDesktopCommand("snap_pip_window");
  } catch {
    // Snapping is cosmetic; the window keeps where the user left it.
  }
}

/** Resizes the call window from the web client, clamped by the shell. */
export async function setDesktopPipSize(width: number, height: number): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeDesktopCommand("set_pip_size", { width, height });
  } catch {
    // A refused resize leaves the window as it was.
  }
}

/**
 * Starts an undecorated window resize from one of the call window's own edge
 * handles. Undecorated windows have no native border to grab on Windows and
 * Linux, so the webview has to ask the window manager to take over the drag.
 */
export async function startDesktopResize(direction: PipResizeDirection): Promise<void> {
  const current = tauri()?.window?.getCurrentWindow?.();
  if (current?.startResizeDragging === undefined) {
    return;
  }
  try {
    await current.startResizeDragging(direction);
  } catch {
    // Without the permission or on an unsupported platform, resizing stays off.
  }
}

/**
 * Closes the call window. The call keeps running in the main window; a no-op
 * when the window is not open.
 */
export async function closeDesktopPipWindow(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeDesktopCommand("close_pip_window");
  } catch {
    // The window is decoration; a refused close must never break the call.
  }
}

/** Whether the shell's separate call window is open. */
export async function isDesktopPipWindowOpen(): Promise<boolean> {
  if (!isDesktop()) {
    return false;
  }
  try {
    return (await invokeDesktopCommand("is_pip_window_open")) === true;
  } catch {
    return false;
  }
}

/** Brings the main window back to the front, e.g. from the call window. */
export async function focusDesktopMainWindow(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeDesktopCommand("focus_main_window");
  } catch {
    // Focus is a convenience; the window can be clicked instead.
  }
}

/**
 * Sends one event to another window of the shell, addressed by label. This is
 * how the main webview and the call window keep each other in step. Best-effort:
 * a missing event bridge must never break a call.
 */
export async function emitDesktopEventTo(
  target: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const api = tauri()?.event;
  if (api === undefined || typeof api.emitTo !== "function") {
    return;
  }
  try {
    await api.emitTo(target, event, payload);
  } catch {
    // The other window may be gone; the state is resent on the next change.
  }
}

export interface DesktopUpdateStatus {
  readonly updateAvailable: boolean;
  readonly version: string | null;
  readonly currentVersion: string;
  readonly notes: string | null;
  readonly error: string | null;
  /** Release publish time as Unix seconds, when the feed provides one. */
  readonly pubDate?: number | null;
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
    const value = await invokeDesktopCommand("check_for_app_update");
    if (!isUpdateStatus(value)) {
      return null;
    }
    return {
      updateAvailable: value.updateAvailable,
      version: typeof value.version === "string" ? value.version : null,
      currentVersion: value.currentVersion,
      notes: typeof value.notes === "string" ? value.notes : null,
      error: typeof value.error === "string" ? value.error : null,
      pubDate: typeof value.pubDate === "number" ? value.pubDate : null,
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
  const value = await invokeDesktopCommand("app_version");
  if (typeof value !== "string") throw new Error("Desktop version is unavailable.");
  return value;
}

/** Downloads and verifies the update without interrupting the app. */
export async function downloadDesktopUpdate(): Promise<void> {
  await invokeDesktopCommand("download_app_update");
}

/** Installs the verified download and restarts the shell. */
export async function installDesktopUpdate(): Promise<void> {
  await invokeDesktopCommand("install_app_update");
}

/** Shows a native notification with device-computed text; best-effort. */
export async function showDesktopNotification(title: string, body: string): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invokeDesktopCommand("show_notification", { title, body });
  } catch {
    // Notifications are best-effort and never block the message pipeline.
  }
}

/**
 * Opens an external URL in the system browser: a new tab on the web, the OS
 * default application inside the desktop shell. The Tauri webview swallows a
 * `target="_blank"` link instead of opening a window, so links hand the URL to
 * the shell. Best-effort: a refused hand-off never breaks the page.
 */
export function openExternal(url: string): void {
  if (isDesktop()) {
    void invokeDesktopCommand("open_external", { url }).catch(() => {
      // The browser may still let the person copy the link instead.
    });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
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
  if (action === "auth") {
    const code = (url.searchParams.get("code") ?? "").trim();
    const error = (url.searchParams.get("error") ?? "").trim();
    const server = (url.searchParams.get("server") ?? "").trim();
    const tx = (url.searchParams.get("tx") ?? "").trim() || undefined;
    if (code.length > 0 && server.length > 0) {
      return { kind: "auth", code, server, tx };
    }
    // The finish route sends `error`, `server` and `tx` when the provider
    // cancels or fails; a server-only link still needs the client's `tx` to be
    // accepted, which the caller checks against its pending transaction.
    if (error.length > 0 && server.length > 0) {
      return { kind: "auth-error", error, server, tx };
    }
    return null;
  }
  return null;
}

export type { TauriGlobal };
