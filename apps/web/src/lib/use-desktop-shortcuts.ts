import { useEffect } from "react";
import { desktopPlatform, isDesktop, toggleDesktopFullscreen } from "./desktop";

/**
 * The shortcuts this module handles. They mirror the commands that the macOS
 * menu bar offers (Connect to Server, Toggle Sidebar) plus fullscreen; Windows
 * and Linux have no menu bar, so these have to be real key handlers.
 */
export type DesktopShortcut = "connect" | "toggle-sidebar" | "toggle-fullscreen";

type KeyEventShape = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/**
 * Maps a keyboard event onto a desktop command, or `null`. Only the Windows and
 * Linux bindings live here: on macOS the native menu owns the same accelerators,
 * so handling them in the page too would run each command twice.
 */
export function matchDesktopShortcut(event: KeyEventShape): DesktopShortcut | null {
  if (event.key === "F11") {
    return "toggle-fullscreen";
  }
  if (!event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "n" && !event.shiftKey) {
    return "connect";
  }
  if (key === "d" && event.shiftKey) {
    return "toggle-sidebar";
  }
  return null;
}

/**
 * Whether the event target is a text field. Only an unmodified F11 is ignored
 * there; the Ctrl chords type nothing, so they work from the composer too, the
 * way the macOS menu accelerators do.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // jsdom does not implement `isContentEditable`; the attribute covers both.
  const editable = target.getAttribute("contenteditable");
  if (target.isContentEditable || (editable !== null && editable !== "false")) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface DesktopShortcutHandlers {
  /** Opens the connect screen, the same path the native menu item takes. */
  readonly onConnect: () => void;
}

/**
 * Binds the Windows/Linux desktop shortcuts: Ctrl+N connects, Ctrl+Shift+D
 * toggles the channel sidebar and F11 toggles fullscreen. A no-op in the
 * browser and on macOS, where the menu bar is the only binding.
 */
export function useDesktopShortcuts({ onConnect }: DesktopShortcutHandlers): void {
  useEffect(() => {
    if (!isDesktop() || desktopPlatform() === "macos") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const action = event.defaultPrevented ? null : matchDesktopShortcut(event);
      if (action === null || (action === "toggle-fullscreen" && isTypingTarget(event.target))) {
        return;
      }
      event.preventDefault();
      if (action === "connect") {
        onConnect();
        return;
      }
      if (action === "toggle-sidebar") {
        // The native menu emits this shell event; the webview consumes both
        // through the same window event.
        window.dispatchEvent(new Event("aulora:toggle-sidebar"));
        return;
      }
      void toggleDesktopFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onConnect]);
}
